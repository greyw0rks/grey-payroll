/** Independently check a Lightning payment preimage against the requested payment hash. */
export async function validPaymentProof(paymentHash: string, preimage: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(paymentHash) || !/^[a-f0-9]{64}$/i.test(preimage)) return false;
  const bytes = Uint8Array.from(preimage.match(/.{2}/g)!, part => parseInt(part, 16));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === paymentHash.toLowerCase();
}
