// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {TicketCollection} from "../src/TicketCollection.sol";

contract TicketCollectionTest is Base {
    function setUp() public {
        _deploySystem();
    }

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

    function test_CheckInCreditsLoyaltyAndFreezes() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        bytes memory sig = _signCheckIn(c, pk, holder, id);
        vm.prank(gate);
        c.checkIn(id, sig);

        assertEq(c.ticket(id).usedAt, uint64(block.timestamp));
        assertEq(loyalty.scoreOf(holder), ATTEND_POINTS);
    }

    function test_CheckInRejectsWrongSigner() public {
        TicketCollection c = _createEvent();
        (address holder,) = makeAddrAndKey("holder");
        (, uint256 wrongPk) = makeAddrAndKey("attacker");
        uint256 id = _mint(c, holder);

        bytes memory sig = _signCheckIn(c, wrongPk, holder, id);
        vm.prank(gate);
        vm.expectRevert(bytes("bad holder signature"));
        c.checkIn(id, sig);
    }

    function test_CheckInRejectsReplay() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 id = _mint(c, holder);

        bytes memory sig = _signCheckIn(c, pk, holder, id);
        vm.prank(gate);
        c.checkIn(id, sig);

        // Same signature again → already used.
        vm.prank(gate);
        vm.expectRevert(TicketCollection.TicketUsed.selector);
        c.checkIn(id, sig);
    }

    function test_UsedTicketCannotMove() public {
        TicketCollection c = _createEvent();
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        address bob = makeAddr("bob");
        uint256 id = _mint(c, holder);

        bytes memory sig = _signCheckIn(c, pk, holder, id);
        vm.prank(gate);
        c.checkIn(id, sig);

        // Even a privileged mover cannot transfer a used ticket.
        vm.prank(organizer);
        vm.expectRevert(TicketCollection.TicketUsed.selector);
        c.transferFrom(holder, bob, id);
    }
}
