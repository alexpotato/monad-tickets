// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LoyaltyRegistry} from "../src/LoyaltyRegistry.sol";
import {AttendanceStub} from "../src/AttendanceStub.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";
import {TicketAuction} from "../src/TicketAuction.sol";
import {EventFactory} from "../src/EventFactory.sol";

/// @notice Deploys the shared ticketing system and wires loyalty writer roles.
///         Run against anvil or Monad testnet:
///         forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
contract Deploy is Script {
    int256 constant ATTEND_POINTS = 10;
    int256 constant BASE_FLIP_PENALTY = 5;

    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address admin;
        if (pk != 0) {
            admin = vm.addr(pk);
            vm.startBroadcast(pk);
        } else {
            // Default anvil account #0.
            admin = msg.sender;
            vm.startBroadcast();
        }

        LoyaltyRegistry loyalty = new LoyaltyRegistry(admin);
        AttendanceStub stub = new AttendanceStub(admin);
        ResaleMarketplace market = new ResaleMarketplace(address(loyalty), BASE_FLIP_PENALTY);
        TicketAuction auction = new TicketAuction(address(loyalty), BASE_FLIP_PENALTY);
        EventFactory factory = new EventFactory(
            address(loyalty), address(stub), address(market), address(auction), admin
        );

        // Factory must be a loyalty + stub admin to grant per-event roles.
        loyalty.grantRole(loyalty.DEFAULT_ADMIN_ROLE(), address(factory));
        stub.grantRole(stub.DEFAULT_ADMIN_ROLE(), address(factory));
        factory.wireSharedContracts();

        vm.stopBroadcast();

        console.log("LoyaltyRegistry:  ", address(loyalty));
        console.log("AttendanceStub:   ", address(stub));
        console.log("ResaleMarketplace:", address(market));
        console.log("TicketAuction:    ", address(auction));
        console.log("EventFactory:     ", address(factory));
    }
}
