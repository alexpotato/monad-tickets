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
