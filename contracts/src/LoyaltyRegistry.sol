// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title LoyaltyRegistry
/// @notice Soulbound, non-transferable per-wallet reputation. Reputation is
///         earned by attending events (check-in) and forfeited by flipping
///         tickets on the secondary market before the event. It is read by the
///         primary sale, resale market, and auction to gate access, apply
///         discounts, and handicap auction bids.
/// @dev There is intentionally no transfer function: a wallet's score can only
///      be changed by authorized platform contracts (writers), and only ever
///      describes the behaviour of that same wallet. This is what makes the
///      reputation a meaningful "who actually uses their tickets" signal.
contract LoyaltyRegistry is AccessControl {
    /// @notice Contracts allowed to mutate scores (TicketCollection on
    ///         check-in; ResaleMarketplace / TicketAuction on flip).
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");

    struct Reputation {
        int256 score; // can go negative for serial scalpers
        uint64 eventsAttended;
        uint64 flips; // resales before the event the wallet sold
    }

    mapping(address => Reputation) private _rep;

    event Attended(address indexed wallet, uint256 indexed tokenId, int256 delta, int256 newScore);
    event Flipped(address indexed wallet, uint256 indexed tokenId, int256 penalty, int256 newScore);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // --- writer surface (only platform contracts) ---

    /// @notice Credit a wallet for attending (called by TicketCollection.checkIn).
    function recordAttendance(address wallet, uint256 tokenId, int256 points)
        external
        onlyRole(WRITER_ROLE)
    {
        require(points >= 0, "points must be >= 0");
        Reputation storage r = _rep[wallet];
        r.score += points;
        r.eventsAttended += 1;
        emit Attended(wallet, tokenId, points, r.score);
    }

    /// @notice Penalize a wallet for reselling before the event (called by
    ///         ResaleMarketplace / TicketAuction on settlement of a resale).
    /// @param penalty A non-negative magnitude; subtracted from the score.
    function recordFlip(address wallet, uint256 tokenId, int256 penalty)
        external
        onlyRole(WRITER_ROLE)
    {
        require(penalty >= 0, "penalty must be >= 0");
        Reputation storage r = _rep[wallet];
        r.score -= penalty;
        r.flips += 1;
        emit Flipped(wallet, tokenId, penalty, r.score);
    }

    // --- read surface ---

    function scoreOf(address wallet) external view returns (int256) {
        return _rep[wallet].score;
    }

    function reputationOf(address wallet) external view returns (Reputation memory) {
        return _rep[wallet];
    }

    /// @notice Auction bid handicap, in basis points, derived from score.
    /// @dev Monotonic in score, clamped to [0, maxBonusBps]. Negative scores
    ///      get zero bonus (never a malus that could underflow a bid). The
    ///      caller (TicketAuction) supplies the per-auction ceiling and the
    ///      slope (bps of bonus per loyalty point).
    /// @param wallet      Bidder.
    /// @param bpsPerPoint Bonus basis points granted per positive score point.
    /// @param maxBonusBps Per-auction ceiling on the bonus.
    function bonusBpsFor(address wallet, uint256 bpsPerPoint, uint256 maxBonusBps)
        external
        view
        returns (uint256)
    {
        int256 s = _rep[wallet].score;
        if (s <= 0) return 0;
        uint256 raw = uint256(s) * bpsPerPoint;
        return raw > maxBonusBps ? maxBonusBps : raw;
    }
}
