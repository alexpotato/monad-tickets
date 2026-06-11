import type { Address, Chain, Hex } from "viem";
import { foundry } from "viem/chains";
import { defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export type RoleKeys = {
  organizer: { name: string; key: Hex };
  gate: { name: string; key: Hex };
  attendees: { name: string; key: Hex }[]; // pre-funded personas (local only)
};

export type ChainProfile = {
  id: "local" | "testnet";
  label: string;
  chain: Chain;
  rpcUrl: string;
  factory: Address | null; // null = contracts not deployed yet
  faucet?: string;
  canAutoFund: boolean; // anvil_setBalance available
  roles: RoleKeys;
};

export const PROFILES: Record<"local" | "testnet", ChainProfile> = {
  local: {
    id: "local",
    label: "Local anvil",
    chain: foundry,
    rpcUrl: "http://127.0.0.1:8545",
    // Deterministic on a fresh anvil seeded with contracts/script/Demo.s.sol.
    factory: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    canAutoFund: true,
    roles: {
      // anvil's well-known dev accounts
      organizer: {
        name: "Olivia (Organizer)",
        key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      },
      gate: {
        name: "Gate Device",
        key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      },
      attendees: [
        { name: "Ava", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
        { name: "Ben", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
        { name: "Cleo", key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
      ],
    },
  },
  testnet: {
    id: "testnet",
    label: "Monad testnet",
    chain: monadTestnet,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    // Set after the testnet deploy (see TESTNET.md), then rebuild/redeploy.
    factory: null,
    faucet: "https://faucet.monad.xyz",
    canAutoFund: false,
    roles: {
      // Shared demo-role keys, testnet-only (committed intentionally, like
      // anvil's public dev keys — fund them per TESTNET.md).
      organizer: {
        name: "Olivia (Organizer)",
        key: "0x5213b386f221f3031a06c173ceb4c18b9e55e6152241a49e0f782113f92a4ed6",
      },
      gate: {
        name: "Gate Device",
        key: "0xe1cf09908e2a03578b2b73bb225c720ba43fe00312c9d005b8cf337eb5b58dbd",
      },
      attendees: [], // on testnet, attendees use the per-device wallet
    },
  },
};

const PROFILE_KEY = "chain-profile";

export function activeProfile(): ChainProfile {
  const stored = localStorage.getItem(PROFILE_KEY);
  if (stored === "local" || stored === "testnet") return PROFILES[stored];
  // Default: local when developing on the machine that runs anvil, testnet
  // when served from the hosted PWA (a phone can't reach localhost anyway).
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return PROFILES[isLocalhost ? "local" : "testnet"];
}

export function switchProfile(id: "local" | "testnet") {
  localStorage.setItem(PROFILE_KEY, id);
  window.location.reload(); // clients are module-level; a reload keeps it simple
}

/// The phone's own wallet: generated on first launch, persisted locally.
/// This is the "you" account when testing the PWA on a real device.
const DEVICE_KEY = "device-wallet-pk";

export function deviceWalletKey(): Hex {
  let pk = localStorage.getItem(DEVICE_KEY) as Hex | null;
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(DEVICE_KEY, pk);
  }
  return pk;
}

export function deviceWalletAddress(): Address {
  return privateKeyToAccount(deviceWalletKey()).address;
}
