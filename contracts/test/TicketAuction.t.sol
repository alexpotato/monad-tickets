// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {TicketCollection} from "../src/TicketCollection.sol";
import {TicketAuction} from "../src/TicketAuction.sol";

contract TicketAuctionTest is Base {
    // Handicap config: 100 bps (1%) of bonus per loyalty point, ceiling 5000 bps (50%).
    uint256 constant BPS_PER_POINT = 100;
    uint256 constant MAX_BONUS_BPS = 5_000;

    function setUp() public {
        _deploySystem();
    }

    /// @dev Give `who` a loyalty score by minting+checking-in a throwaway ticket.
    function _earnLoyalty(TicketCollection c, address who, uint256 pk) internal {
        uint256 id = _mint(c, who);
        bytes memory sig = _signCheckIn(c, pk, who, id);
        vm.prank(gate);
        c.checkIn(id, sig);
    }

    function test_LoyaltyHandicapFlipsWinner() public {
        TicketCollection c = _createEvent();

        // Loyal attendee earns 10 points → 10 * 100 = 1000 bps = 10% bonus.
        (address loyal, uint256 loyalPk) = makeAddrAndKey("loyal");
        _earnLoyalty(c, loyal, loyalPk);
        assertEq(loyalty.scoreOf(loyal), ATTEND_POINTS);

        address flipper = makeAddr("flipper"); // zero score

        // Primary auction for a new ticket.
        vm.prank(organizer);
        uint256 aid = auction.createPrimaryAuction(
            address(c), 0, 0.1 ether, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );

        // Flipper bids MORE cash (1.00), loyal bids LESS (0.95).
        // Effective: flipper 1.00; loyal 0.95 * 1.10 = 1.045 → loyal leads.
        vm.deal(flipper, 1 ether);
        vm.prank(flipper);
        auction.bid{value: 1 ether}(aid);

        vm.deal(loyal, 0.95 ether);
        vm.prank(loyal);
        auction.bid{value: 0.95 ether}(aid);

        // Settle.
        vm.warp(block.timestamp + 2 days);
        auction.settle(aid);

        // Loyal wallet won despite the lower raw bid. Token id 2 is the auctioned one
        // (id 1 was the throwaway loyalty ticket).
        assertEq(c.ownerOf(2), loyal);

        // Winner pays their ACTUAL bid (0.95), not the handicapped figure.
        // Flipper can withdraw their full deposit.
        uint256 flipperBefore = flipper.balance;
        vm.prank(flipper);
        auction.withdrawRefund(aid);
        assertEq(flipper.balance - flipperBefore, 1 ether);
    }

    function test_BonusClampedAtCeiling() public {
        TicketCollection c = _createEvent();
        (address loyal, uint256 pk) = makeAddrAndKey("loyal");
        // Earn lots of loyalty: 6 check-ins = 60 points → 6000 bps raw, clamped to 5000.
        for (uint256 i = 0; i < 6; i++) {
            _earnLoyalty(c, loyal, pk);
        }
        assertEq(loyalty.scoreOf(loyal), ATTEND_POINTS * 6);

        // Low ceiling auction: maxBonus 5000 bps. previewEffectiveBid on 1 ether
        // should be 1.5 ether (capped), not 1.6.
        vm.prank(organizer);
        uint256 aid = auction.createPrimaryAuction(
            address(c), 0, 0, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );
        uint256 eff = auction.previewEffectiveBid(aid, loyal, 1 ether);
        assertEq(eff, 1.5 ether);
    }

    function test_WinnerPaysOwnBid_OrganizerReceivesIt() public {
        TicketCollection c = _createEvent();
        address bidder = makeAddr("bidder");

        vm.prank(organizer);
        uint256 aid = auction.createPrimaryAuction(
            address(c), 0, 0.5 ether, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );

        vm.deal(bidder, 0.8 ether);
        vm.prank(bidder);
        auction.bid{value: 0.8 ether}(aid);

        uint256 orgBefore = organizer.balance;
        vm.warp(block.timestamp + 2 days);
        auction.settle(aid);

        assertEq(organizer.balance - orgBefore, 0.8 ether);
        assertEq(c.ownerOf(1), bidder);
    }

    function test_ResaleAuctionCannotExceedCap() public {
        TicketCollection c = _createEvent();
        address seller = makeAddr("seller");
        uint256 id = _mint(c, seller);

        vm.prank(seller);
        uint256 aid = auction.createResaleAuction(
            address(c), id, 0.5 ether, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );

        address bidder = makeAddr("bidder");
        vm.deal(bidder, 2 ether);
        vm.prank(bidder);
        vm.expectRevert(TicketAuction.AboveCap.selector);
        auction.bid{value: RESALE_CAP + 1}(aid);
    }

    function test_ResaleAuctionPenalizesSeller() public {
        TicketCollection c = _createEvent();
        address seller = makeAddr("seller");
        address bidder = makeAddr("bidder");
        uint256 id = _mint(c, seller);

        vm.prank(seller);
        uint256 aid = auction.createResaleAuction(
            address(c), id, 0.5 ether, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );

        vm.deal(bidder, RESALE_CAP);
        vm.prank(bidder);
        auction.bid{value: RESALE_CAP}(aid); // 1.2 ether = 20% over face

        uint256 sellerBefore = seller.balance;
        vm.warp(block.timestamp + 2 days);
        auction.settle(aid);

        assertEq(c.ownerOf(id), bidder);
        uint256 royalty = (RESALE_CAP * ROYALTY_BPS) / 10_000;
        assertEq(seller.balance - sellerBefore, RESALE_CAP - royalty);
        // base 5 + margin 2 = 7 penalty
        assertEq(loyalty.scoreOf(seller), -(BASE_FLIP_PENALTY + 2));
    }

    function test_LowerEffectiveBidReverts() public {
        TicketCollection c = _createEvent();
        address a1 = makeAddr("a1");
        address a2 = makeAddr("a2");

        vm.prank(organizer);
        uint256 aid = auction.createPrimaryAuction(
            address(c), 0, 0.1 ether, BPS_PER_POINT, MAX_BONUS_BPS, uint64(block.timestamp + 1 days)
        );

        vm.deal(a1, 1 ether);
        vm.prank(a1);
        auction.bid{value: 1 ether}(aid);

        // a2 (no loyalty) bids lower → must revert.
        vm.deal(a2, 0.5 ether);
        vm.prank(a2);
        vm.expectRevert(TicketAuction.BidTooLow.selector);
        auction.bid{value: 0.5 ether}(aid);
    }
}
