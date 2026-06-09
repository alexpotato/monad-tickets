// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {TicketCollection} from "../src/TicketCollection.sol";
import {ResaleMarketplace} from "../src/ResaleMarketplace.sol";

contract ResaleMarketplaceTest is Base {
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");

    function setUp() public {
        _deploySystem();
    }

    function test_ListRevertsAboveCap() public {
        TicketCollection c = _createEvent();
        uint256 id = _mint(c, seller);
        vm.prank(seller);
        vm.expectRevert(ResaleMarketplace.PriceAboveCap.selector);
        market.list(address(c), id, RESALE_CAP + 1);
    }

    function test_ListAndBuySplitsRoyaltyAndPenalizesFlip() public {
        TicketCollection c = _createEvent();
        uint256 id = _mint(c, seller);

        uint256 price = RESALE_CAP; // 1.2 ether, 20% over face
        vm.prank(seller);
        market.list(address(c), id, price);

        vm.deal(buyer, price);
        uint256 sellerBefore = seller.balance;
        uint256 orgBefore = organizer.balance;

        vm.prank(buyer);
        market.buy{value: price}(address(c), id);

        // Ownership moved via privileged path.
        assertEq(c.ownerOf(id), buyer);
        assertEq(c.ticket(id).lastSalePrice, price);

        uint256 royalty = (price * ROYALTY_BPS) / 10_000;
        assertEq(organizer.balance - orgBefore, royalty);
        assertEq(seller.balance - sellerBefore, price - royalty);

        // Flip penalty: base + margin (20% over face → +2 by curve).
        // marginBps = 2000; /1000 = 2. total = 5 + 2 = 7.
        assertEq(loyalty.scoreOf(seller), -(BASE_FLIP_PENALTY + 2));
    }

    function test_BuyWrongPaymentReverts() public {
        TicketCollection c = _createEvent();
        uint256 id = _mint(c, seller);
        vm.prank(seller);
        market.list(address(c), id, FACE);

        vm.deal(buyer, FACE);
        vm.prank(buyer);
        vm.expectRevert(ResaleMarketplace.WrongPayment.selector);
        market.buy{value: FACE - 1}(address(c), id);
    }

    function test_SellAtFaceOnlyBasePenalty() public {
        TicketCollection c = _createEvent();
        uint256 id = _mint(c, seller);
        vm.prank(seller);
        market.list(address(c), id, FACE);

        vm.deal(buyer, FACE);
        vm.prank(buyer);
        market.buy{value: FACE}(address(c), id);

        assertEq(loyalty.scoreOf(seller), -BASE_FLIP_PENALTY);
    }
}
