// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILoyaltyRegistry} from "./interfaces/ILoyaltyRegistry.sol";
import {ITicketCollection} from "./interfaces/ITicketCollection.sol";

/// @title ResaleMarketplace
/// @notice The only fixed-price resale path for tickets. Listings are capped at
///         the collection's resale cap; settlement routes a royalty to the
///         organizer and the remainder to the seller, moves the ticket through
///         the privileged `marketTransfer`, and applies a loyalty flip penalty
///         to the seller (the resale necessarily happens before the event,
///         since used tickets are frozen).
/// @dev Non-custodial: the seller keeps the ticket until purchase. The seller
///      must have granted this contract MARKET_ROLE rights via the collection
///      (done at event creation) so `marketTransfer` can move the token.
contract ResaleMarketplace is ReentrancyGuard {
    ILoyaltyRegistry public immutable loyalty;

    /// @notice Loyalty penalty applied to a seller per flip, scaled by margin.
    ///         baseFlipPenalty is always applied; an extra penalty scales with
    ///         how far above face the ticket sold (capped sales still cost).
    int256 public immutable baseFlipPenalty;

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    // collection => tokenId => listing
    mapping(address => mapping(uint256 => Listing)) public listings;

    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(address indexed collection, uint256 indexed tokenId);
    event Resold(
        address indexed collection,
        uint256 indexed tokenId,
        address seller,
        address indexed buyer,
        uint256 price,
        uint256 royalty,
        uint64 timestamp
    );

    error NotOwner();
    error PriceAboveCap();
    error NotListed();
    error WrongPayment();

    constructor(address loyalty_, int256 baseFlipPenalty_) {
        require(baseFlipPenalty_ >= 0, "penalty >= 0");
        loyalty = ILoyaltyRegistry(loyalty_);
        baseFlipPenalty = baseFlipPenalty_;
    }

    /// @notice List a ticket for resale at `price` (must be <= the collection's cap).
    function list(address collection, uint256 tokenId, uint256 price) external {
        ITicketCollection c = ITicketCollection(collection);
        if (c.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (price > c.resaleCap()) revert PriceAboveCap();
        listings[collection][tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit Listed(collection, tokenId, msg.sender, price);
    }

    function cancel(address collection, uint256 tokenId) external {
        Listing storage l = listings[collection][tokenId];
        if (!l.active || l.seller != msg.sender) revert NotListed();
        delete listings[collection][tokenId];
        emit Cancelled(collection, tokenId);
    }

    /// @notice Buy a listed ticket. Pays royalty to organizer, remainder to
    ///         seller, transfers the ticket, and penalizes the seller's loyalty.
    function buy(address collection, uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[collection][tokenId];
        if (!l.active) revert NotListed();
        if (msg.value != l.price) revert WrongPayment();

        ITicketCollection c = ITicketCollection(collection);
        // Listing could be stale if the seller no longer holds the ticket.
        if (c.ownerOf(tokenId) != l.seller) revert NotOwner();

        delete listings[collection][tokenId];

        uint256 royalty = (l.price * c.royaltyBps()) / 10_000;
        uint256 toSeller = l.price - royalty;

        // Move the ticket through the privileged path (also enforces cap/used).
        c.marketTransfer(l.seller, msg.sender, tokenId, l.price);

        // Penalize the seller for flipping before the event, scaled by margin.
        int256 penalty = _flipPenalty(c, tokenId, l.price);
        loyalty.recordFlip(l.seller, tokenId, penalty);

        if (royalty > 0) {
            (bool ok1,) = payable(c.organizer()).call{value: royalty}("");
            require(ok1, "royalty xfer failed");
        }
        (bool ok2,) = payable(l.seller).call{value: toSeller}("");
        require(ok2, "seller xfer failed");

        emit Resold(collection, tokenId, l.seller, msg.sender, l.price, royalty, uint64(block.timestamp));
    }

    /// @dev Base penalty plus a margin component: the more above face the
    ///      ticket sold, the larger the loyalty hit. Selling at/below face is
    ///      only the base penalty.
    function _flipPenalty(ITicketCollection c, uint256 tokenId, uint256 price)
        internal
        view
        returns (int256)
    {
        uint256 face = c.ticket(tokenId).facePrice;
        int256 penalty = baseFlipPenalty;
        if (price > face && face > 0) {
            // +1 penalty point per 10% of face captured as margin.
            uint256 marginBps = ((price - face) * 10_000) / face;
            penalty += int256(marginBps / 1_000);
        }
        return penalty;
    }
}
