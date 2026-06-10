// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {TicketCollection} from "../src/TicketCollection.sol";
import {AttendanceStub} from "../src/AttendanceStub.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";

contract TicketCollectionTest is Base {
    function setUp() public {
        _deploySystem();
    }

    // --- primary sale: seats ---

    function _listSeats(TicketCollection c) internal {
        string[] memory labels = new string[](3);
        labels[0] = "A-1";
        labels[1] = "A-2";
        labels[2] = "A-3";
        vm.prank(organizer);
        c.listSeats(labels, 0, FACE);
    }

    function test_BuySeatMintsAndPaysOrganizer() public {
        TicketCollection c = _createEvent();
        _listSeats(c);
        address fan = makeAddr("fan");
        vm.deal(fan, FACE);

        uint256 orgBefore = organizer.balance;
        vm.prank(fan);
        uint256 id = c.buySeat{value: FACE}("A-2");

        assertEq(c.ownerOf(id), fan);
        assertEq(c.seatOf(id), "A-2");
        assertEq(c.ticket(id).facePrice, FACE);
        assertEq(organizer.balance - orgBefore, FACE);
        assertEq(c.seatCount(), 3);
    }

    function test_SeatSellsExactlyOnce() public {
        TicketCollection c = _createEvent();
        _listSeats(c);
        address fan = makeAddr("fan");
        address fan2 = makeAddr("fan2");
        vm.deal(fan, FACE);
        vm.deal(fan2, FACE);

        vm.prank(fan);
        c.buySeat{value: FACE}("A-1");

        vm.prank(fan2);
        vm.expectRevert(TicketCollection.SeatUnavailable.selector);
        c.buySeat{value: FACE}("A-1");
    }

    function test_BuySeatWrongPaymentOrUnlistedReverts() public {
        TicketCollection c = _createEvent();
        _listSeats(c);
        address fan = makeAddr("fan");
        vm.deal(fan, FACE);

        vm.prank(fan);
        vm.expectRevert(TicketCollection.WrongPayment.selector);
        c.buySeat{value: FACE - 1}("A-1");

        vm.prank(fan);
        vm.expectRevert(TicketCollection.SeatUnavailable.selector);
        c.buySeat{value: FACE}("Z-99");
    }

    function test_BuySeatsBatchOneTx() public {
        TicketCollection c = _createEvent();
        _listSeats(c);
        address fan = makeAddr("fan");
        vm.deal(fan, 3 * FACE);

        string[] memory picks = new string[](2);
        picks[0] = "A-1";
        picks[1] = "A-3";

        uint256 orgBefore = organizer.balance;
        vm.prank(fan);
        uint256[] memory ids = c.buySeats{value: 2 * FACE}(picks);

        assertEq(ids.length, 2);
        assertEq(c.ownerOf(ids[0]), fan);
        assertEq(c.ownerOf(ids[1]), fan);
        assertEq(c.seatOf(ids[1]), "A-3");
        assertEq(organizer.balance - orgBefore, 2 * FACE);
    }

    function test_BuySeatsWrongTotalReverts() public {
        TicketCollection c = _createEvent();
        _listSeats(c);
        address fan = makeAddr("fan");
        vm.deal(fan, 3 * FACE);

        string[] memory picks = new string[](2);
        picks[0] = "A-1";
        picks[1] = "A-2";

        vm.prank(fan);
        vm.expectRevert(TicketCollection.WrongPayment.selector);
        c.buySeats{value: FACE}(picks); // half the total

        // Atomic: nothing sold.
        (, , , uint256 sold) = c.seatListing(keccak256("A-1"));
        assertEq(sold, 0);
    }

    function test_OnlyOrganizerCanListSeats() public {
        TicketCollection c = _createEvent();
        string[] memory labels = new string[](1);
        labels[0] = "A-1";
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(); // missing ORGANIZER_ROLE
        c.listSeats(labels, 0, FACE);
    }

    // --- transfer restriction ---

    function test_OtcTransferReverts() public {
        TicketCollection c = _createEvent();
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        uint256 id = _mint(c, alice);

        vm.prank(alice);
        vm.expectRevert(TicketCollection.TransferRestricted.selector);
        c.transferFrom(alice, bob, id);
    }

    function test_MarketCanMoveTicketViaMarketTransfer() public {
        TicketCollection c = _createEvent();
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        uint256 id = _mint(c, alice);

        // The marketplace holds MARKET_ROLE → privileged settlement move.
        vm.prank(address(market));
        c.marketTransfer(alice, bob, id, FACE);
        assertEq(c.ownerOf(id), bob);
        assertEq(c.ticket(id).lastSalePrice, FACE);
    }

    function test_NonMarketCannotCallMarketTransfer() public {
        TicketCollection c = _createEvent();
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        uint256 id = _mint(c, alice);

        vm.prank(bob);
        vm.expectRevert(); // missing MARKET_ROLE
        c.marketTransfer(alice, bob, id, FACE);
    }

    // --- check-in: ticket swap ---

    function test_CheckInSwapsTicketForStub() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        _checkIn(c, holder, pk, id);

        // Ticket handed back to the event wallet — the attendance record.
        assertEq(c.ownerOf(id), organizer);
        assertEq(c.ticket(id).usedAt, uint64(block.timestamp));

        // Soulbound stub minted to the attendee with full provenance.
        assertEq(stub.ownerOf(1), holder);
        (address fromCollection, uint256 ticketId, uint64 attendedAt) = stub.provenance(1);
        assertEq(fromCollection, address(c));
        assertEq(ticketId, id);
        assertEq(attendedAt, uint64(block.timestamp));

        // Loyalty credited.
        assertEq(loyalty.scoreOf(holder), ATTEND_POINTS);
    }

    function test_CheckInRejectsWrongSigner() public {
        TicketCollection c = _createEvent();
        (address holder,) = makeAddrAndKey("holder");
        (, uint256 wrongPk) = makeAddrAndKey("attacker");
        uint256 id = _mint(c, holder);

        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckIn(c, wrongPk, holder, id, VENUE_CODE);
        vm.prank(gate);
        vm.expectRevert(bytes("bad holder signature"));
        c.checkIn(id, VENUE_CODE, sig);
    }

    function test_CheckInRejectsSecondUse() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        _checkIn(c, holder, pk, id);

        // Ticket is used (and now lives in the event wallet) → second check-in reverts.
        bytes memory sig = _signCheckIn(c, pk, holder, id, VENUE_CODE);
        vm.prank(gate);
        vm.expectRevert(TicketCollection.TicketUsed.selector);
        c.checkIn(id, VENUE_CODE, sig);
    }

    // --- check-in: venue code ---

    function test_CheckInWrongCodeReverts() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckIn(c, pk, holder, id, "WRONG-0000");
        vm.prank(gate);
        vm.expectRevert(TicketCollection.BadGateCode.selector);
        c.checkIn(id, "WRONG-0000", sig);
    }

    function test_CheckInSignatureMustBindSubmittedCode() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        // Code is active, but the holder signed over a DIFFERENT code than the
        // one submitted — the binding must fail.
        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckIn(c, pk, holder, id, "OTHER-1111");
        vm.prank(gate);
        vm.expectRevert(bytes("bad holder signature"));
        c.checkIn(id, VENUE_CODE, sig);
    }

    function test_CheckInExpiredCodeReverts() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckIn(c, pk, holder, id, VENUE_CODE);

        vm.warp(block.timestamp + c.codeValidity() + 1);
        vm.prank(gate);
        vm.expectRevert(TicketCollection.BadGateCode.selector);
        c.checkIn(id, VENUE_CODE, sig);
    }

    function test_PreviousCodeValidWithinGraceOnly() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        (address holder2, uint256 pk2) = makeAddrAndKey("holder2");
        uint256 id = _mint(c, holder);
        uint256 id2 = _mint(c, holder2);

        // Sign against code A, then the venue rotates to code B.
        _setGateCode(c, VENUE_CODE);
        bytes memory sigA = _signCheckIn(c, pk, holder, id, VENUE_CODE);
        _setGateCode(c, "NEXT-8888");

        // Within the grace window the old code still lands.
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(gate);
        c.checkIn(id, VENUE_CODE, sigA);
        assertEq(c.ownerOf(id), organizer);

        // After grace, the old code is dead.
        vm.warp(block.timestamp + 5 minutes);
        bytes memory sigA2 = _signCheckIn(c, pk2, holder2, id2, VENUE_CODE);
        vm.prank(gate);
        vm.expectRevert(TicketCollection.BadGateCode.selector);
        c.checkIn(id2, VENUE_CODE, sigA2);
    }

    function test_OnlyGateOrOrganizerCanSetCode() public {
        TicketCollection c = _createEvent();
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(bytes("not authorized"));
        c.setGateCode(keccak256("X"));
    }

    // --- batch check-in ---

    function test_CheckInBatchOneSignature() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256[] memory ids = new uint256[](2);
        ids[0] = _mint(c, holder);
        ids[1] = _mint(c, holder);

        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckInBatch(c, pk, holder, ids, VENUE_CODE);
        vm.prank(gate);
        c.checkInBatch(ids, VENUE_CODE, sig);

        // Both tickets swapped; two stubs; double loyalty; nonce bumped once.
        assertEq(c.ownerOf(ids[0]), organizer);
        assertEq(c.ownerOf(ids[1]), organizer);
        assertEq(stub.balanceOf(holder), 2);
        assertEq(loyalty.scoreOf(holder), 2 * ATTEND_POINTS);
        assertEq(c.checkInNonce(holder), 1);
    }

    function test_CheckInBatchAtomicWhenOneUsed() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256[] memory ids = new uint256[](2);
        ids[0] = _mint(c, holder);
        ids[1] = _mint(c, holder);

        _checkIn(c, holder, pk, ids[1]); // second ticket already used → now owned
        // by the event wallet, so the batch fails the same-holder check.
        // (A used-but-still-held state is unreachable: check-in always
        // transfers the ticket away.)

        bytes memory sig = _signCheckInBatch(c, pk, holder, ids, VENUE_CODE);
        vm.prank(gate);
        vm.expectRevert(bytes("mixed holders"));
        c.checkInBatch(ids, VENUE_CODE, sig);

        // Atomic: the first (valid) ticket is untouched by the failed batch.
        assertEq(c.ownerOf(ids[0]), holder);
        assertEq(stub.balanceOf(holder), 1);
    }

    function test_CheckInBatchMixedHoldersReverts() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        address other = makeAddr("other");
        uint256[] memory ids = new uint256[](2);
        ids[0] = _mint(c, holder);
        ids[1] = _mint(c, other);

        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckInBatch(c, pk, holder, ids, VENUE_CODE);
        vm.prank(gate);
        vm.expectRevert(bytes("mixed holders"));
        c.checkInBatch(ids, VENUE_CODE, sig);
    }

    function test_CheckInBatchSigCoversExactTokenList() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256[] memory ids = new uint256[](2);
        ids[0] = _mint(c, holder);
        ids[1] = _mint(c, holder);

        _setGateCode(c, VENUE_CODE);
        // Sign over only the first ticket, submit both — must fail.
        uint256[] memory one = new uint256[](1);
        one[0] = ids[0];
        bytes memory sig = _signCheckInBatch(c, pk, holder, one, VENUE_CODE);
        vm.prank(gate);
        vm.expectRevert(bytes("bad holder signature"));
        c.checkInBatch(ids, VENUE_CODE, sig);
    }

    // --- post-check-in invariants ---

    function test_UsedTicketCannotMove() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        _checkIn(c, holder, pk, id);

        // Even a privileged mover cannot transfer a used ticket.
        vm.prank(address(market));
        vm.expectRevert(TicketCollection.TicketUsed.selector);
        c.marketTransfer(organizer, holder, id, FACE);
    }

    function test_CheckedInTicketCannotBeListed() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        _checkIn(c, holder, pk, id);

        // Holder no longer owns the ticket, so listing it reverts.
        vm.prank(holder);
        vm.expectRevert(ResaleMarketplace.NotOwner.selector);
        market.list(address(c), id, FACE);
    }

    function test_StubIsSoulbound() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        address bob = makeAddr("bob");
        uint256 id = _mint(c, holder);

        _checkIn(c, holder, pk, id);
        assertEq(stub.ownerOf(1), holder);

        vm.prank(holder);
        vm.expectRevert(AttendanceStub.Soulbound.selector);
        stub.transferFrom(holder, bob, 1);
    }
}
