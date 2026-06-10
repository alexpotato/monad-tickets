// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LoyaltyRegistry} from "../src/LoyaltyRegistry.sol";
import {AttendanceStub} from "../src/AttendanceStub.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";
import {TicketAuction} from "../src/TicketAuction.sol";
import {EventFactory} from "../src/EventFactory.sol";
import {TicketCollection} from "../src/TicketCollection.sol";

/// @dev Shared deployment + helpers for the ticketing test suite.
contract Base is Test {
    LoyaltyRegistry loyalty;
    AttendanceStub stub;
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
    string constant VENUE_CODE = "MOSH-7421"; // shown on venue screens

    function _deploySystem() internal {
        vm.startPrank(admin);
        loyalty = new LoyaltyRegistry(admin);
        stub = new AttendanceStub(admin);
        market = new ResaleMarketplace(address(loyalty), BASE_FLIP_PENALTY);
        auction = new TicketAuction(address(loyalty), BASE_FLIP_PENALTY);

        // Factory needs to grant loyalty WRITER_ROLE and stub MINTER_ROLE →
        // make it an admin of both.
        factory =
            new EventFactory(address(loyalty), address(stub), address(market), address(auction), admin);
        loyalty.grantRole(loyalty.DEFAULT_ADMIN_ROLE(), address(factory));
        stub.grantRole(stub.DEFAULT_ADMIN_ROLE(), address(factory));
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

    /// @dev Gate sets the active venue code (the plaintext is what screens show).
    function _setGateCode(TicketCollection c, string memory code) internal {
        vm.prank(gate);
        c.setGateCode(keccak256(bytes(code)));
    }

    /// @dev Produce a holder check-in signature binding the typed venue code.
    function _signCheckIn(
        TicketCollection c,
        uint256 pk,
        address holder,
        uint256 tokenId,
        string memory code
    ) internal view returns (bytes memory) {
        uint256 nonce = c.checkInNonce(holder);
        bytes32 inner = keccak256(
            abi.encode(address(c), block.chainid, tokenId, nonce, keccak256(bytes(code)))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Batch variant: one signature over the whole token list.
    function _signCheckInBatch(
        TicketCollection c,
        uint256 pk,
        address holder,
        uint256[] memory tokenIds,
        string memory code
    ) internal view returns (bytes memory) {
        uint256 nonce = c.checkInNonce(holder);
        bytes32 inner = keccak256(
            abi.encode(
                address(c),
                block.chainid,
                keccak256(abi.encodePacked(tokenIds)),
                nonce,
                keccak256(bytes(code))
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Full happy-path check-in: set code, sign as holder, submit as gate.
    function _checkIn(TicketCollection c, address holder, uint256 pk, uint256 tokenId) internal {
        _setGateCode(c, VENUE_CODE);
        bytes memory sig = _signCheckIn(c, pk, holder, tokenId, VENUE_CODE);
        vm.prank(gate);
        c.checkIn(tokenId, VENUE_CODE, sig);
    }
}
