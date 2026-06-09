// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {TicketCollection} from "../src/TicketCollection.sol";
import {TicketAuction} from "../src/TicketAuction.sol";

/// @notice Full lifecycle exercising the whole system end to end:
///   create event → primary sale → resale (capped, royalty, flip penalty) →
///   score-weighted auction where a loyal wallet beats a higher cash bid →
///   check-in (loyalty credit + freeze) → OTC transfer reverts.
contract E2ETest is Base {
    uint256 constant BPS_PER_POINT = 100;
    uint256 constant MAX_BONUS_BPS = 5_000;

    function test_FullLifecycle() public {
        _deploySystem();
        TicketCollection c = _createEvent();

        // --- 1. Primary sale: organizer mints a ticket to Alice. ---
        address alice = makeAddr("alice");
        uint256 t1 = _mint(c, alice);
        assertEq(c.ownerOf(t1), alice);

        // --- 2. Alice resells to Bob at the cap via the marketplace. ---
        address bob = makeAddr("bob");
        vm.prank(alice);
        market.list(address(c), t1, RESALE_CAP);

        vm.deal(bob, RESALE_CAP);
        uint256 orgBefore = organizer.balance;
        vm.prank(bob);
        market.buy{value: RESALE_CAP}(address(c), t1);

        assertEq(c.ownerOf(t1), bob);
        // Royalty routed; Alice penalized for flipping above face.
        assertEq(organizer.balance - orgBefore, (RESALE_CAP * ROYALTY_BPS) / 10_000);
        assertLt(loyalty.scoreOf(alice), 0);

        // --- 3. Bob checks in → earns loyalty, ticket freezes. ---
        // (Bob signs; the gate submits.)
        (address bobSigner, uint256 bobPk) = makeAddrAndKey("bobSigner");
        // Move the ticket to a signer wallet we hold the key for, via the market.
        vm.prank(address(market));
        c.marketTransfer(bob, bobSigner, t1, RESALE_CAP);

        bytes memory sig = _signCheckIn(c, bobPk, bobSigner, t1);
        vm.prank(gate);
        c.checkIn(t1, sig);
        assertEq(c.ticket(t1).usedAt, uint64(block.timestamp));
        assertEq(loyalty.scoreOf(bobSigner), ATTEND_POINTS);

        // Used ticket can no longer move.
        vm.prank(address(market));
        vm.expectRevert(TicketCollection.TicketUsed.selector);
        c.marketTransfer(bobSigner, alice, t1, FACE);

        // --- 4. Score-weighted primary auction: loyal wallet beats cash. ---
        // Give `loyal` a positive score via a check-in on a fresh ticket.
        (address loyal, uint256 loyalPk) = makeAddrAndKey("loyal");
        uint256 tL = _mint(c, loyal);
        bytes memory lsig = _signCheckIn(c, loyalPk, loyal, tL);
        vm.prank(gate);
        c.checkIn(tL, lsig); // loyal now has ATTEND_POINTS (10) → 10% handicap

        address whale = makeAddr("whale"); // deep pockets, zero loyalty
        vm.prank(organizer);
        uint256 aid = auction.createPrimaryAuction(
            address(c), 0, 0.1 ether, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );

        // Whale bids 1.00; loyal bids 0.95. Effective: whale 1.00, loyal 1.045.
        vm.deal(whale, 1 ether);
        vm.prank(whale);
        auction.bid{value: 1 ether}(aid);
        vm.deal(loyal, 0.95 ether);
        vm.prank(loyal);
        auction.bid{value: 0.95 ether}(aid);

        vm.warp(block.timestamp + 2 days);
        auction.settle(aid);

        // The most-recently minted token is the auctioned one. Loyal won it.
        uint256 wonId = tL + 1;
        assertEq(c.ownerOf(wonId), loyal);

        // Whale refunded in full (winner paid their own 0.95, not the handicap).
        uint256 whaleBefore = whale.balance;
        vm.prank(whale);
        auction.withdrawRefund(aid);
        assertEq(whale.balance - whaleBefore, 1 ether);

        // --- 5. OTC transfer of the won ticket reverts. ---
        vm.prank(loyal);
        vm.expectRevert(TicketCollection.TransferRestricted.selector);
        c.transferFrom(loyal, whale, wonId);
    }
}
