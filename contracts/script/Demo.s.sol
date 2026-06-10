// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LoyaltyRegistry} from "../src/LoyaltyRegistry.sol";
import {AttendanceStub} from "../src/AttendanceStub.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";
import {TicketAuction} from "../src/TicketAuction.sol";
import {EventFactory} from "../src/EventFactory.sol";
import {TicketCollection} from "../src/TicketCollection.sol";

/// @notice Seeds a fresh anvil node for the web demo: deploys the system,
///         creates a sample event, and lists a seat map. Uses anvil's
///         well-known accounts so the web app can act as each persona:
///           #0 admin/deployer, #1 organizer, #2 gate, #3-5 attendees.
///         Run: forge script script/Demo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract Demo is Script {
    // anvil default mnemonic keys
    uint256 constant ADMIN_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ORGANIZER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant GATE_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    int256 constant ATTEND_POINTS = 10;
    int256 constant BASE_FLIP_PENALTY = 5;
    uint256 constant FACE = 0.05 ether;

    function run() external {
        address admin = vm.addr(ADMIN_PK);
        address organizer = vm.addr(ORGANIZER_PK);
        address gate = vm.addr(GATE_PK);

        // --- system (account #0; deterministic addresses on fresh anvil) ---
        vm.startBroadcast(ADMIN_PK);
        LoyaltyRegistry loyalty = new LoyaltyRegistry(admin);
        AttendanceStub stub = new AttendanceStub(admin);
        ResaleMarketplace market = new ResaleMarketplace(address(loyalty), BASE_FLIP_PENALTY);
        TicketAuction auction = new TicketAuction(address(loyalty), BASE_FLIP_PENALTY);
        EventFactory factory = new EventFactory(
            address(loyalty), address(stub), address(market), address(auction), admin
        );
        loyalty.grantRole(loyalty.DEFAULT_ADMIN_ROLE(), address(factory));
        stub.grantRole(stub.DEFAULT_ADMIN_ROLE(), address(factory));
        factory.wireSharedContracts();
        vm.stopBroadcast();

        // --- sample event (created + seeded by the organizer) ---
        vm.startBroadcast(ORGANIZER_PK);
        EventFactory.EventParams memory p = EventFactory.EventParams({
            name: "Monad Live: Block Party",
            symbol: "BLOCK",
            organizer: organizer,
            gate: gate,
            eventStartTime: uint64(block.timestamp + 7 days),
            resaleCap: (FACE * 120) / 100, // face + 20%
            royaltyBps: 500,
            attendPoints: ATTEND_POINTS
        });
        TicketCollection c = TicketCollection(factory.createEvent(p));

        // Seat map: rows A-C floor (tier 0), rows D-E balcony (tier 1).
        string[3] memory floorRows = ["A", "B", "C"];
        string[2] memory balconyRows = ["D", "E"];
        for (uint256 r = 0; r < floorRows.length; r++) {
            c.listSeats(_row(floorRows[r], 6), 0, FACE);
        }
        for (uint256 r = 0; r < balconyRows.length; r++) {
            c.listSeats(_row(balconyRows[r], 6), 1, (FACE * 60) / 100);
        }
        vm.stopBroadcast();

        console.log("EventFactory:    ", address(factory));
        console.log("TicketCollection:", address(c));
        console.log("Organizer:       ", organizer);
        console.log("Gate:            ", gate);
        console.log("Seats listed:    ", c.seatCount());
    }

    function _row(string memory rowLabel, uint256 count) internal pure returns (string[] memory labels) {
        labels = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            labels[i] = string.concat(rowLabel, "-", vm.toString(i + 1));
        }
    }
}
