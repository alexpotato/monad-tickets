// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ILoyaltyRegistry} from "./interfaces/ILoyaltyRegistry.sol";
import {ITicketCollection} from "./interfaces/ITicketCollection.sol";
import {IAttendanceStub} from "./interfaces/IAttendanceStub.sol";

/// @title TicketCollection
/// @notice One ERC-721 collection per event. Tickets are restricted-transfer:
///         they can only move through an authorized market contract (resale
///         marketplace / auction) or the organizer, never peer-to-peer. This
///         guarantees every resale is captured and price-checked on-chain.
///         At the door, `checkIn` swaps the ticket for a souvenir: the holder
///         signs over a venue-displayed rotating code, the gate submits (and
///         pays gas), the ticket transfers back to the event wallet — the
///         canonical on-chain attendance record — and a soulbound stub is
///         minted to the attendee along with their loyalty credit.
contract TicketCollection is ERC721, AccessControl, ITicketCollection {
    using ECDSA for bytes32;

    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE"); // marketplace + auction
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant GATE_ROLE = keccak256("GATE_ROLE"); // submits check-ins

    address public immutable organizer;
    ILoyaltyRegistry public immutable loyalty;
    IAttendanceStub public immutable stub;

    uint64 public immutable eventStartTime;
    uint256 public immutable resaleCap; // max resale price (wei); ceiling for resale auctions too
    uint96 public immutable royaltyBps; // resale royalty to organizer, in bps
    int256 public immutable attendPoints; // loyalty awarded per check-in

    // --- rotating venue code (typed by the attendee, bound into their sig) ---
    uint64 public constant CODE_GRACE = 2 minutes; // old code stays valid briefly after rotation
    uint64 public codeValidity = 15 minutes;
    bytes32 public currentCodeHash;
    uint64 public codeSetAt;
    bytes32 public prevCodeHash;
    uint64 public prevExpiresAt;

    bool private _inCheckIn; // scopes the check-in transfer privilege in _update

    uint256 private _nextId = 1;
    mapping(uint256 => Ticket) private _tickets;
    mapping(address => uint256) public checkInNonce; // replay protection for check-in sigs

    // --- primary sale: named seats listed by the organizer ---
    struct SeatListing {
        uint16 tier;
        uint256 price;
        bool active;
        uint256 tokenId; // 0 until sold
    }

    mapping(bytes32 => SeatListing) public seatListing; // keccak256(label) => listing
    string[] public seatLabels; // enumeration for UIs
    mapping(uint256 => string) public seatOf; // tokenId => seat label

    event Minted(uint256 indexed tokenId, address indexed to, uint16 tier, uint256 price);
    event CheckedIn(uint256 indexed tokenId, address indexed holder, uint64 at);
    event GateCodeRotated(bytes32 indexed codeHash, uint64 at);
    event SeatsListed(uint16 indexed tier, uint256 price, uint256 count);
    event SeatSold(string label, uint256 indexed tokenId, address indexed buyer, uint256 price);

    error TransferRestricted();
    error TicketUsed();
    error PriceAboveCap();
    error BadGateCode();
    error SeatUnavailable();
    error WrongPayment();

    constructor(
        string memory name_,
        string memory symbol_,
        address organizer_,
        address loyalty_,
        address stub_,
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
        stub = IAttendanceStub(stub_);
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

    // --- primary sale: seat listing + purchase ---

    /// @notice List named seats (e.g. "A-12") at a tier and face price. Buyers
    ///         purchase directly on-chain via `buySeat`.
    function listSeats(string[] calldata labels, uint16 tier, uint256 price)
        external
        onlyRole(ORGANIZER_ROLE)
    {
        for (uint256 i = 0; i < labels.length; i++) {
            bytes32 key = keccak256(bytes(labels[i]));
            require(!seatListing[key].active, "seat already listed");
            seatListing[key] = SeatListing({tier: tier, price: price, active: true, tokenId: 0});
            seatLabels.push(labels[i]);
        }
        emit SeatsListed(tier, price, labels.length);
    }

    /// @notice Buy a listed seat. Mints the ticket to the buyer and pays the
    ///         organizer. Each seat sells exactly once on the primary market.
    function buySeat(string calldata label) external payable returns (uint256 tokenId) {
        SeatListing storage s = seatListing[keccak256(bytes(label))];
        if (!s.active || s.tokenId != 0) revert SeatUnavailable();
        if (msg.value != s.price) revert WrongPayment();

        tokenId = _nextId++;
        _tickets[tokenId] = Ticket({
            tier: s.tier,
            facePrice: s.price,
            mintedAt: uint64(block.timestamp),
            usedAt: 0,
            lastSalePrice: s.price
        });
        s.tokenId = tokenId;
        seatOf[tokenId] = label;
        _safeMint(msg.sender, tokenId);

        (bool ok,) = payable(organizer).call{value: msg.value}("");
        require(ok, "organizer xfer failed");

        emit SeatSold(label, tokenId, msg.sender, msg.value);
        emit Minted(tokenId, msg.sender, s.tier, msg.value);
    }

    function seatCount() external view returns (uint256) {
        return seatLabels.length;
    }

    function allSeats() external view returns (string[] memory) {
        return seatLabels;
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
        // _inCheckIn permits exactly one move — the ticket-return inside
        // checkIn — without giving the gate any general transfer power.
        bool privileged =
            _inCheckIn || hasRole(MARKET_ROLE, msg.sender) || hasRole(ORGANIZER_ROLE, msg.sender);

        if (!isMintOrBurn && !privileged) revert TransferRestricted();
        // A used (checked-in) ticket is frozen — it cannot be resold.
        if (!isMintOrBurn && !_inCheckIn && _tickets[tokenId].usedAt != 0) revert TicketUsed();

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

    // --- check-in (identity + presence at the door) ---

    /// @notice Rotate the venue code. The venue displays the plaintext code on
    ///         screens; only its hash goes on-chain. The outgoing code stays
    ///         valid for CODE_GRACE so signatures built moments before a
    ///         rotation still land. Cheap to call every few minutes on Monad.
    function setGateCode(bytes32 codeHash) external {
        require(
            hasRole(GATE_ROLE, msg.sender) || hasRole(ORGANIZER_ROLE, msg.sender), "not authorized"
        );
        if (currentCodeHash != bytes32(0)) {
            prevCodeHash = currentCodeHash;
            prevExpiresAt = uint64(block.timestamp) + CODE_GRACE;
        }
        currentCodeHash = codeHash;
        codeSetAt = uint64(block.timestamp);
        emit GateCodeRotated(codeHash, codeSetAt);
    }

    function setCodeValidity(uint64 seconds_) external onlyRole(ORGANIZER_ROLE) {
        require(seconds_ > 0, "validity must be > 0");
        codeValidity = seconds_;
    }

    function _codeIsActive(bytes32 h) internal view returns (bool) {
        if (h != bytes32(0) && h == currentCodeHash && block.timestamp <= codeSetAt + codeValidity)
        {
            return true;
        }
        if (h != bytes32(0) && h == prevCodeHash && block.timestamp <= prevExpiresAt) return true;
        return false;
    }

    /// @notice Check in a ticket — the attendee swaps it for a souvenir stub.
    ///
    ///         The attendee types the venue-displayed code into their app and
    ///         signs (collection, chainid, tokenId, nonce, codeHash): wallet
    ///         control AND code knowledge in one signature, with the nonce
    ///         preventing replay. The gate submits and pays gas, so check-in is
    ///         free for the attendee. On success the ticket transfers back to
    ///         the event wallet (the immutable attendance record), a soulbound
    ///         AttendanceStub is minted to the holder, and their loyalty score
    ///         is credited.
    function checkIn(uint256 tokenId, string calldata code, bytes calldata holderSig)
        external
        onlyRole(GATE_ROLE)
    {
        address holder = ownerOf(tokenId);
        Ticket storage t = _tickets[tokenId];
        if (t.usedAt != 0) revert TicketUsed();

        bytes32 codeHash = keccak256(bytes(code));
        if (!_codeIsActive(codeHash)) revert BadGateCode();

        uint256 nonce = checkInNonce[holder];
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, tokenId, nonce, codeHash))
        );
        require(digest.recover(holderSig) == holder, "bad holder signature");
        checkInNonce[holder] = nonce + 1;

        // Hand the ticket back to the event wallet — the canonical on-chain
        // proof of attendance. _inCheckIn scopes the transfer privilege.
        _inCheckIn = true;
        _safeTransfer(holder, organizer, tokenId, "");
        _inCheckIn = false;

        t.usedAt = uint64(block.timestamp);
        stub.mint(holder, address(this), tokenId);
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
