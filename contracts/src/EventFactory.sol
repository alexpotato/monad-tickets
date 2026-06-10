// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {TicketCollection} from "./TicketCollection.sol";
import {LoyaltyRegistry} from "./LoyaltyRegistry.sol";
import {AttendanceStub} from "./AttendanceStub.sol";

/// @title EventFactory
/// @notice Deploys a per-event TicketCollection wired to the shared
///         LoyaltyRegistry, ResaleMarketplace, and TicketAuction, and grants
///         the loyalty WRITER_ROLE to the new collection (check-in credits) so
///         the whole system is connected at creation. The factory must hold
///         admin on the LoyaltyRegistry to grant those roles; the marketplace
///         and auction are granted WRITER_ROLE once, here, the first time.
contract EventFactory is AccessControl {
    LoyaltyRegistry public immutable loyalty;
    AttendanceStub public immutable stub;
    address public immutable marketplace;
    address public immutable auction;

    address[] public events;
    mapping(address => bool) public isEvent;

    event EventCreated(
        address indexed collection,
        address indexed organizer,
        string name,
        uint64 eventStartTime,
        uint256 resaleCap
    );

    constructor(
        address loyalty_,
        address stub_,
        address marketplace_,
        address auction_,
        address admin
    ) {
        loyalty = LoyaltyRegistry(loyalty_);
        stub = AttendanceStub(stub_);
        marketplace = marketplace_;
        auction = auction_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Grant the shared market + auction loyalty WRITER_ROLE so they can
    ///         apply flip penalties. Idempotent; must be called once after the
    ///         factory has been made a LoyaltyRegistry admin. Anyone may call it
    ///         (it only ever grants the two known shared contracts).
    function wireSharedContracts() public {
        bytes32 writer = loyalty.WRITER_ROLE();
        if (!loyalty.hasRole(writer, marketplace)) loyalty.grantRole(writer, marketplace);
        if (!loyalty.hasRole(writer, auction)) loyalty.grantRole(writer, auction);
    }

    struct EventParams {
        string name;
        string symbol;
        address organizer;
        address gate;
        uint64 eventStartTime;
        uint256 resaleCap;
        uint96 royaltyBps;
        int256 attendPoints;
    }

    /// @notice Deploy and register a new event collection.
    function createEvent(EventParams calldata p) external returns (address collection) {
        // Ensure shared market/auction can write loyalty (idempotent).
        wireSharedContracts();

        TicketCollection c = new TicketCollection(
            p.name,
            p.symbol,
            p.organizer,
            address(loyalty),
            address(stub),
            marketplace,
            p.gate,
            p.eventStartTime,
            p.resaleCap,
            p.royaltyBps,
            p.attendPoints
        );
        collection = address(c);

        // The auction also moves tickets / mints, so it needs MARKET_ROLE too.
        c.grantRole(c.MARKET_ROLE(), auction);

        // The collection credits loyalty on check-in → needs WRITER_ROLE,
        // and mints the souvenir stub at check-in → needs MINTER_ROLE.
        loyalty.grantRole(loyalty.WRITER_ROLE(), collection);
        stub.grantRole(stub.MINTER_ROLE(), collection);

        events.push(collection);
        isEvent[collection] = true;
        emit EventCreated(collection, p.organizer, p.name, p.eventStartTime, p.resaleCap);
    }

    function eventCount() external view returns (uint256) {
        return events.length;
    }
}
