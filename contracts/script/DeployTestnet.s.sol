// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LoyaltyRegistry} from "../src/LoyaltyRegistry.sol";
import {AttendanceStub} from "../src/AttendanceStub.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";
import {TicketAuction} from "../src/TicketAuction.sol";
import {EventFactory} from "../src/EventFactory.sol";
import {TicketCollection} from "../src/TicketCollection.sol";

/// @notice Monad testnet deployment + demo seed. See TESTNET.md for the full
///         runbook (funding, then pasting the factory address into the PWA).
///
///         PRIVATE_KEY=0x... forge script script/DeployTestnet.s.sol \
///           --rpc-url https://testnet-rpc.monad.xyz --broadcast
///
///         Demo-role keys are shared and committed (testnet-only, like anvil's
///         dev keys) so anyone running the hosted PWA can act as organizer/gate.
contract DeployTestnet is Script {
    // Shared demo roles — also baked into web/src/lib/profiles.ts.
    uint256 constant ORGANIZER_PK = 0x5213b386f221f3031a06c173ceb4c18b9e55e6152241a49e0f782113f92a4ed6;
    address constant GATE = 0xaDdB5c3D8CB297dfe3A10DdF275c2f3e6a40E9d4;

    int256 constant ATTEND_POINTS = 10;
    int256 constant BASE_FLIP_PENALTY = 5;
    uint256 constant FACE = 0.01 ether; // faucet-friendly prices

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(deployerPk);
        address organizer = vm.addr(ORGANIZER_PK);

        // --- system (funded deployer) ---
        vm.startBroadcast(deployerPk);
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

        // --- demo event (shared organizer key; fund it first, see TESTNET.md) ---
        vm.startBroadcast(ORGANIZER_PK);
        EventFactory.EventParams memory p = EventFactory.EventParams({
            name: "Monad Live: Block Party",
            symbol: "BLOCK",
            organizer: organizer,
            gate: GATE,
            eventStartTime: uint64(block.timestamp + 30 days),
            resaleCap: (FACE * 120) / 100,
            royaltyBps: 500,
            attendPoints: ATTEND_POINTS
        });
        TicketCollection c = TicketCollection(factory.createEvent(p));

        string[3] memory floorRows = ["A", "B", "C"];
        string[2] memory balconyRows = ["D", "E"];
        for (uint256 r = 0; r < floorRows.length; r++) {
            c.listSeats(_row(floorRows[r], 6), 0, FACE);
        }
        for (uint256 r = 0; r < balconyRows.length; r++) {
            c.listSeats(_row(balconyRows[r], 6), 1, (FACE * 60) / 100);
        }
        vm.stopBroadcast();

        console.log("");
        console.log("=== PASTE INTO web/src/lib/profiles.ts (testnet.factory) ===");
        console.log("EventFactory:    ", address(factory));
        console.log("=============================================================");
        console.log("TicketCollection:", address(c));
        console.log("Organizer:       ", organizer);
        console.log("Gate:            ", GATE);
        console.log("Seats listed:    ", c.seatCount());
    }

    function _row(string memory rowLabel, uint256 count) internal pure returns (string[] memory labels) {
        labels = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            labels[i] = string.concat(rowLabel, "-", vm.toString(i + 1));
        }
    }
}
