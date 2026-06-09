// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ILoyaltyRegistry} from "./interfaces/ILoyaltyRegistry.sol";
import {ITicketCollection} from "./interfaces/ITicketCollection.sol";

/// @title TicketCollection
/// @notice One ERC-721 collection per event. Tickets are restricted-transfer:
///         they can only move through an authorized market contract (resale
///         marketplace / auction) or the organizer, never peer-to-peer. This
///         guarantees every resale is captured and price-checked on-chain.
///         Attendance is recorded at the door via `checkIn`, which credits the
///         holder's soulbound loyalty score and freezes the ticket.
contract TicketCollection is ERC721, AccessControl, ITicketCollection {
    using ECDSA for bytes32;

    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE"); // marketplace + auction
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant GATE_ROLE = keccak256("GATE_ROLE"); // submits check-ins

    address public immutable organizer;
    ILoyaltyRegistry public immutable loyalty;

    uint64 public immutable eventStartTime;
    uint256 public immutable resaleCap; // max resale price (wei); ceiling for resale auctions too
    uint96 public immutable royaltyBps; // resale royalty to organizer, in bps
    int256 public immutable attendPoints; // loyalty awarded per check-in

    uint256 private _nextId = 1;
    mapping(uint256 => Ticket) private _tickets;
    mapping(address => uint256) public checkInNonce; // replay protection for check-in sigs

    event Minted(uint256 indexed tokenId, address indexed to, uint16 tier, uint256 price);
    event CheckedIn(uint256 indexed tokenId, address indexed holder, uint64 at);

    error TransferRestricted();
    error TicketUsed();
    error PriceAboveCap();

    constructor(
        string memory name_,
        string memory symbol_,
        address organizer_,
        address loyalty_,
        address market_,
        address gate_,
        uint64 eventStartTime_,
        uint256 resaleCap_,
        uint96 royaltyBps_,
        int256 attendPoints_
    ) ERC721(name_, symbol_) {
        require(royaltyBps_ <= 10_000, "royalty too high");
        organizer = organizer_;
        loyalty = ILoyaltyRegistry(loyalty_);
        eventStartTime = eventStartTime_;
        resaleCap = resaleCap_;
        royaltyBps = royaltyBps_;
        attendPoints = attendPoints_;

        _grantRole(DEFAULT_ADMIN_ROLE, organizer_);
        // The deployer (EventFactory) also gets admin so it can wire shared
        // contracts (e.g. grant MARKET_ROLE to the auction) right after deploy.
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORGANIZER_ROLE, organizer_);
        _grantRole(MARKET_ROLE, market_);
        _grantRole(GATE_ROLE, gate_);
    }

    // --- minting (primary sale) ---

    /// @notice Mint a ticket for primary sale. Callable by organizer (direct
    ///         sale / allocation) or an authorized market contract (primary
    ///         auction settlement).
    function mintTo(address to, uint16 tier, uint256 price)
        external
        returns (uint256 tokenId)
    {
        require(hasRole(ORGANIZER_ROLE, msg.sender) || hasRole(MARKET_ROLE, msg.sender), "not authorized");
        tokenId = _nextId++;
        _tickets[tokenId] = Ticket({
            tier: tier,
            facePrice: price,
            mintedAt: uint64(block.timestamp),
            usedAt: 0,
            lastSalePrice: price
        });
        _safeMint(to, tokenId);
        emit Minted(tokenId, to, tier, price);
    }

    // --- restricted transfer ---

    /// @dev The single chokepoint for all ownership changes. Permits mint
    ///      (from == 0), burn (to == 0), and transfers initiated by an
    ///      authorized market contract or the organizer. Everything else —
    ///      including direct `transferFrom`/`safeTransferFrom` between users —
    ///      reverts, so the official market is the only resale path.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        bool isMintOrBurn = from == address(0) || to == address(0);
        bool privileged = hasRole(MARKET_ROLE, msg.sender) || hasRole(ORGANIZER_ROLE, msg.sender);

        if (!isMintOrBurn && !privileged) revert TransferRestricted();
        // A used (checked-in) ticket is frozen — it cannot be resold.
        if (!isMintOrBurn && _tickets[tokenId].usedAt != 0) revert TicketUsed();

        return super._update(to, tokenId, auth);
    }

    /// @notice Privileged settlement transfer used by the marketplace/auction.
    ///         Enforces the resale cap and records the sale price.
    function marketTransfer(address from, address to, uint256 tokenId, uint256 salePrice)
        external
        onlyRole(MARKET_ROLE)
    {
        if (salePrice > resaleCap) revert PriceAboveCap();
        if (_tickets[tokenId].usedAt != 0) revert TicketUsed();
        _tickets[tokenId].lastSalePrice = salePrice;
        // msg.sender holds MARKET_ROLE, so _update permits this move.
        _safeTransfer(from, to, tokenId, "");
    }

    // --- check-in (identity at the door) ---

    /// @notice Check in a ticket. The gate submits a signature produced by the
    ///         current holder over (tokenId, nonce, this contract, chainid),
    ///         proving wallet control without any KYC. Marks the ticket used,
    ///         freezes it, and credits the holder's loyalty score.
    function checkIn(uint256 tokenId, bytes calldata holderSig) external onlyRole(GATE_ROLE) {
        address holder = ownerOf(tokenId);
        Ticket storage t = _tickets[tokenId];
        if (t.usedAt != 0) revert TicketUsed();

        uint256 nonce = checkInNonce[holder];
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, tokenId, nonce))
        );
        require(digest.recover(holderSig) == holder, "bad holder signature");
        checkInNonce[holder] = nonce + 1;

        t.usedAt = uint64(block.timestamp);
        loyalty.recordAttendance(holder, tokenId, attendPoints);
        emit CheckedIn(tokenId, holder, t.usedAt);
    }

    // --- views ---

    function ticket(uint256 tokenId) external view returns (Ticket memory) {
        return _tickets[tokenId];
    }

    function ownerOf(uint256 tokenId)
        public
        view
        override(ERC721, ITicketCollection)
        returns (address)
    {
        return super.ownerOf(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
