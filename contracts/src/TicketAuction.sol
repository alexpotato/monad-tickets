// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILoyaltyRegistry} from "./interfaces/ILoyaltyRegistry.sol";
import {ITicketCollection} from "./interfaces/ITicketCollection.sol";

/// @title TicketAuction
/// @notice Score-weighted (handicap) auction for primary and resale tickets.
///         Bids are ranked by an *effective* bid that weights the raw bid up by
///         a loyalty bonus, so a loyal attendee can win over a higher cash bid
///         from a no-reputation wallet. The winner pays their *actual* bid
///         (the handicap affects ranking only); losing bids are fully
///         refundable via pull payments.
contract TicketAuction is ReentrancyGuard {
    ILoyaltyRegistry public immutable loyalty;
    int256 public immutable baseFlipPenalty; // applied to seller on resale auctions

    enum Kind {
        Primary, // ticket minted to the winner on settlement
        Resale // existing token transferred from seller on settlement
    }

    struct Auction {
        address collection;
        uint256 tokenId; // resale: the token; primary: tier encoded in `tier`
        uint16 tier; // primary only
        Kind kind;
        address seller; // resale: current holder; primary: organizer (royalty sink unused)
        uint256 reserve; // minimum raw bid
        uint256 bpsPerPoint; // handicap slope
        uint256 maxBonusBps; // handicap ceiling
        uint64 endTime;
        bool settled;
        address topBidder;
        uint256 topBid; // raw (actual) amount the leader will pay
        uint256 topEffective; // handicapped amount used for ranking
    }

    uint256 public nextAuctionId = 1;
    mapping(uint256 => Auction) public auctions;
    // auctionId => bidder => refundable balance (outbid deposits)
    mapping(uint256 => mapping(address => uint256)) public refunds;

    event AuctionCreated(
        uint256 indexed auctionId, address indexed collection, uint256 tokenId, Kind kind, uint64 endTime
    );
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 bid, uint256 effectiveBid);
    event Settled(uint256 indexed auctionId, address indexed winner, uint256 pricePaid);
    event Refunded(uint256 indexed auctionId, address indexed bidder, uint256 amount);

    error NotSeller();
    error AlreadyEnded();
    error NotEnded();
    error AlreadySettled();
    error BidTooLow();
    error AboveCap();
    error NoBids();

    constructor(address loyalty_, int256 baseFlipPenalty_) {
        require(baseFlipPenalty_ >= 0, "penalty >= 0");
        loyalty = ILoyaltyRegistry(loyalty_);
        baseFlipPenalty = baseFlipPenalty_;
    }

    // --- creation ---

    /// @notice Create a resale auction for a ticket the caller owns.
    function createResaleAuction(
        address collection,
        uint256 tokenId,
        uint256 reserve,
        uint256 bpsPerPoint,
        uint256 maxBonusBps,
        uint64 endTime
    ) external returns (uint256 id) {
        ITicketCollection c = ITicketCollection(collection);
        if (c.ownerOf(tokenId) != msg.sender) revert NotSeller();
        if (reserve > c.resaleCap()) revert AboveCap();
        require(endTime > block.timestamp, "end in past");

        id = nextAuctionId++;
        auctions[id] = Auction({
            collection: collection,
            tokenId: tokenId,
            tier: 0,
            kind: Kind.Resale,
            seller: msg.sender,
            reserve: reserve,
            bpsPerPoint: bpsPerPoint,
            maxBonusBps: maxBonusBps,
            endTime: endTime,
            settled: false,
            topBidder: address(0),
            topBid: 0,
            topEffective: 0
        });
        emit AuctionCreated(id, collection, tokenId, Kind.Resale, endTime);
    }

    /// @notice Create a primary auction; the organizer must grant this contract
    ///         MARKET_ROLE on the collection so it can mint the won ticket.
    function createPrimaryAuction(
        address collection,
        uint16 tier,
        uint256 reserve,
        uint256 bpsPerPoint,
        uint256 maxBonusBps,
        uint64 endTime
    ) external returns (uint256 id) {
        ITicketCollection c = ITicketCollection(collection);
        if (msg.sender != c.organizer()) revert NotSeller();
        require(endTime > block.timestamp, "end in past");

        id = nextAuctionId++;
        auctions[id] = Auction({
            collection: collection,
            tokenId: 0,
            tier: tier,
            kind: Kind.Primary,
            seller: c.organizer(),
            reserve: reserve,
            bpsPerPoint: bpsPerPoint,
            maxBonusBps: maxBonusBps,
            endTime: endTime,
            settled: false,
            topBidder: address(0),
            topBid: 0,
            topEffective: 0
        });
        emit AuctionCreated(id, collection, 0, Kind.Primary, endTime);
    }

    // --- bidding ---

    /// @notice Place a bid. `msg.value` is the actual amount the bidder will pay
    ///         if they win. Ranking uses the handicapped effective bid. If
    ///         outbid, the deposit becomes withdrawable via `withdrawRefund`.
    function bid(uint256 auctionId) external payable nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.collection != address(0), "no auction");
        if (block.timestamp >= a.endTime) revert AlreadyEnded();
        if (msg.value < a.reserve) revert BidTooLow();

        // Resale auctions cap the raw price at the collection's resale cap.
        if (a.kind == Kind.Resale) {
            if (msg.value > ITicketCollection(a.collection).resaleCap()) revert AboveCap();
        }

        uint256 bonus = loyalty.bonusBpsFor(msg.sender, a.bpsPerPoint, a.maxBonusBps);
        uint256 effective = msg.value + (msg.value * bonus) / 10_000;

        // Must strictly beat the current effective leader.
        if (a.topBidder != address(0) && effective <= a.topEffective) revert BidTooLow();

        // Demote the previous leader's deposit to a refund.
        if (a.topBidder != address(0)) {
            refunds[auctionId][a.topBidder] += a.topBid;
        }

        a.topBidder = msg.sender;
        a.topBid = msg.value;
        a.topEffective = effective;
        emit BidPlaced(auctionId, msg.sender, msg.value, effective);
    }

    function withdrawRefund(uint256 auctionId) external nonReentrant {
        uint256 amt = refunds[auctionId][msg.sender];
        require(amt > 0, "nothing to refund");
        refunds[auctionId][msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amt}("");
        require(ok, "refund failed");
        emit Refunded(auctionId, msg.sender, amt);
    }

    // --- settlement ---

    /// @notice Settle after end: deliver the ticket to the winner, pay out, and
    ///         (for resale) apply the seller's loyalty flip penalty. Winner pays
    ///         their actual top bid; the handicap never changes the amount paid.
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.collection != address(0), "no auction");
        if (block.timestamp < a.endTime) revert NotEnded();
        if (a.settled) revert AlreadySettled();
        if (a.topBidder == address(0)) revert NoBids();

        a.settled = true;
        ITicketCollection c = ITicketCollection(a.collection);
        uint256 price = a.topBid;

        if (a.kind == Kind.Primary) {
            // Mint the won ticket; full proceeds to the organizer.
            c.mintTo(a.topBidder, a.tier, price);
            (bool ok,) = payable(c.organizer()).call{value: price}("");
            require(ok, "organizer xfer failed");
        } else {
            // Resale: royalty to organizer, remainder to seller, penalize flip.
            uint256 royalty = (price * c.royaltyBps()) / 10_000;
            uint256 toSeller = price - royalty;

            c.marketTransfer(a.seller, a.topBidder, a.tokenId, price);

            int256 penalty = _flipPenalty(c, a.tokenId, price);
            loyalty.recordFlip(a.seller, a.tokenId, penalty);

            if (royalty > 0) {
                (bool ok1,) = payable(c.organizer()).call{value: royalty}("");
                require(ok1, "royalty xfer failed");
            }
            (bool ok2,) = payable(a.seller).call{value: toSeller}("");
            require(ok2, "seller xfer failed");
        }

        emit Settled(auctionId, a.topBidder, price);
    }

    // --- views / helpers ---

    /// @notice Preview the effective (handicapped) bid for a wallet at a raw amount.
    function previewEffectiveBid(uint256 auctionId, address bidder, uint256 rawBid)
        external
        view
        returns (uint256)
    {
        Auction storage a = auctions[auctionId];
        uint256 bonus = loyalty.bonusBpsFor(bidder, a.bpsPerPoint, a.maxBonusBps);
        return rawBid + (rawBid * bonus) / 10_000;
    }

    function _flipPenalty(ITicketCollection c, uint256 tokenId, uint256 price)
        internal
        view
        returns (int256)
    {
        uint256 face = c.ticket(tokenId).facePrice;
        int256 penalty = baseFlipPenalty;
        if (price > face && face > 0) {
            uint256 marginBps = ((price - face) * 10_000) / face;
            penalty += int256(marginBps / 1_000);
        }
        return penalty;
    }
}
