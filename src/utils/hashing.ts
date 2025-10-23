import { HederaChainId } from "../types";

type InvalidChecksumResult = {
  isValid: false;
  status: 0;
};

type ValidChecksumResult = {
  isValid: boolean;
  status: 1 | 2 | 3;
  num1: number;
  num2: number;
  num3: number;
  givenChecksum: string | undefined;
  correctChecksum: string;
  noChecksumFormat: string;
  withChecksumFormat: string;
};

type ChecksumAddressResult = InvalidChecksumResult | ValidChecksumResult;

function checksum(ledgerId: string, addr: string) {
  let answer = "";
  let d: number[] = []; //digits with 10 for ".", so if addr == "0.0.123" then d == [0, 10, 0, 10, 1, 2, 3]
  let sd0 = 0; //sum of even positions (mod 11)
  let sd1 = 0; //sum of odd positions (mod 11)
  let sd = 0; //weighted sum of all positions (mod p3)
  let sh = 0; //hash of the ledger ID
  let c = 0; //the checksum, before the final permutation
  let cp = 0; //the checksum, as a single number
  const p3 = 26 * 26 * 26; //3 digits in base 26
  const p5 = 26 * 26 * 26 * 26 * 26; //5 digits in base 26
  const ascii_a = "a".charCodeAt(0); //97
  const m = 1_000_003; //min prime greater than a million. Used for the final permutation.
  const w = 31; //sum s of digit values weights them by powers of w. Should be coprime to p5.

  let id = ledgerId + "000000000000";
  let h: number[] = [];
  if (id.length % 2 == 1) id = "0" + id;
  for (var i = 0; i < id.length; i += 2) {
    h.push(parseInt(id.substring(i, i + 2), 16));
  }
  for (let i = 0; i < addr.length; i++) {
    const char = addr[i]!;
    d.push(char === "." ? 10 : parseInt(char, 10));
  }
  for (let i = 0; i < d.length; i++) {
    sd = (w * sd + d[i]!) % p3;
    if (i % 2 == 0) {
      sd0 = (sd0 + d[i]!) % 11;
    } else {
      sd1 = (sd1 + d[i]!) % 11;
    }
  }
  for (let i = 0; i < h.length; i++) {
    sh = (w * sh + h[i]!) % p5;
  }
  c = ((((addr.length % 5) * 11 + sd0) * 11 + sd1) * p3 + sd + sh) % p5;
  cp = (c * m) % p5;

  for (let i = 0; i < 5; i++) {
    answer = String.fromCharCode(ascii_a + (cp % 26)) + answer;
    cp /= 26;
  }

  return answer;
}

export function toChecksumAddress(
  chainId: HederaChainId,
  address: string
): ChecksumAddressResult {
  let match = address.match(
    /^(0|(?:[1-9]\d*))\.(0|(?:[1-9]\d*))\.(0|(?:[1-9]\d*))(?:-([a-z]{5}))?$/
  );
  if (!match) {
    return { isValid: false, status: 0 } as const;
  }

  // Map HederaChainId to ledgerId
  const ledgerIdMap: Record<HederaChainId, string> = {
    [HederaChainId.Mainnet]: "00",
    [HederaChainId.Testnet]: "01",
    [HederaChainId.Previewnet]: "02",
    [HederaChainId.Devnet]: "01", // Devnet uses same as testnet
  };

  const ledgerId = ledgerIdMap[chainId];
  let a = [parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!)];
  let ad = `${a[0]!}.${a[1]!}.${a[2]!}`;
  let c = checksum(ledgerId, ad);
  let s = (match[4] === undefined ? 2 : c == match[4] ? 3 : 1) as 1 | 2 | 3; //the status
  let result: ValidChecksumResult = {
    isValid: s != 1,
    status: s,
    num1: a[0]!,
    num2: a[1]!,
    num3: a[2]!,
    givenChecksum: match[4],
    correctChecksum: c,
    noChecksumFormat: ad,
    withChecksumFormat: `${ad}-${c}`,
  };
  return result;
}
