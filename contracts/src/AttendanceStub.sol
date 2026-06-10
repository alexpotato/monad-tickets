// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AttendanceStub
/// @notice Soulbound souvenir minted to an attendee at check-in, in exchange
///         for the ticket they hand back to the event wallet. The stub is the
///         attendee's permanent, non-transferable proof they were there
///         (POAP-style) and is the user-visible artifact behind the loyalty
///         score. One shared contract for the platform; each TicketCollection
///         is granted MINTER_ROLE by the EventFactory at event creation.
contract AttendanceStub is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct Provenance {
        address collection; // the event the stub came from
        uint256 ticketId; // the ticket that was handed back
        uint64 attendedAt;
    }

    uint256 private _nextId = 1;
    mapping(uint256 => Provenance) public provenance;

    event StubMinted(
        uint256 indexed stubId, address indexed to, address indexed collection, uint256 ticketId
    );

    error Soulbound();

    constructor(address admin) ERC721("Attendance Stub", "STUB") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mint a stub to the attendee. Called by a TicketCollection
    ///         during checkIn, in the same transaction that returns the ticket.
    function mint(address to, address collection, uint256 ticketId)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 stubId)
    {
        stubId = _nextId++;
        provenance[stubId] = Provenance({
            collection: collection,
            ticketId: ticketId,
            attendedAt: uint64(block.timestamp)
        });
        _safeMint(to, stubId);
        emit StubMinted(stubId, to, collection, ticketId);
    }

    /// @dev Soulbound: only minting (from == 0) is permitted. Any transfer or
    ///      burn attempt reverts — the stub is bound to the wallet that
    ///      attended, which is what makes it meaningful.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
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
