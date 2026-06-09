// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LoyaltyRegistry} from "../src/LoyaltyRegistry.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";
import {TicketAuction} from "../src/TicketAuction.sol";
import {EventFactory} from "../src/EventFactory.sol";
import {TicketCollection} from "../src/TicketCollection.sol";

/// @dev Shared deployment + helpers for the ticketing test suite.
contract Base is Test {
    LoyaltyRegistry loyalty;
    ResaleMarketplace market;
    TicketAuction auction;
    EventFactory factory;

    address admin = makeAddr("admin");
    address organizer = makeAddr("organizer");
    address gate = makeAddr("gate");

    int256 constant ATTEND_POINTS = 10;
    int256 constant BASE_FLIP_PENALTY = 5;
    uint64 constant EVENT_START = 1_000_000;
    uint256 constant FACE = 1 ether;
    uint256 constant RESALE_CAP = 1.2 ether; // face + 20%
    uint96 constant ROYALTY_BPS = 500; // 5%

    function _deploySystem() internal {
        vm.startPrank(admin);
        loyalty = new LoyaltyRegistry(admin);
        market = new ResaleMarketplace(address(loyalty), BASE_FLIP_PENALTY);
        auction = new TicketAuction(address(loyalty), BASE_FLIP_PENALTY);

        // Factory needs to grant loyalty WRITER_ROLE → make it loyalty admin.
        factory = new EventFactory(address(loyalty), address(market), address(auction), admin);
        loyalty.grantRole(loyalty.DEFAULT_ADMIN_ROLE(), address(factory));
        vm.stopPrank();
    }

    function _createEvent() internal returns (TicketCollection c) {
        EventFactory.EventParams memory p = EventFactory.EventParams({
            name: "Show",
            symbol: "SHOW",
            organizer: organizer,
            gate: gate,
            eventStartTime: EVENT_START,
            resaleCap: RESALE_CAP,
            royaltyBps: ROYALTY_BPS,
            attendPoints: ATTEND_POINTS
        });
        vm.prank(organizer);
        c = TicketCollection(factory.createEvent(p));
    }

    /// @dev Organizer mints a primary ticket directly to `to`.
    function _mint(TicketCollection c, address to) internal returns (uint256 id) {
        vm.prank(organizer);
        id = c.mintTo(to, 0, FACE);
    }

    /// @dev Produce a holder check-in signature for the current nonce.
    function _signCheckIn(TicketCollection c, uint256 pk, address holder, uint256 tokenId)
        internal
        view
        returns (bytes memory)
    {
        uint256 nonce = c.checkInNonce(holder);
        bytes32 inner = keccak256(abi.encode(address(c), block.chainid, tokenId, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
