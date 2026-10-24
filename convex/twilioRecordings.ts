"use node";

function getTwilioRecordingUrl(recordingSid: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) throw new Error("Twilio account SID is not configured.");
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${encodeURIComponent(recordingSid)}.json`;
}

function getTwilioAuthHeader() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials are not configured.");
  }
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

export async function deleteRecordingFromTwilio(recordingSid: string) {
  const response = await fetch(getTwilioRecordingUrl(recordingSid), {
    method: "DELETE",
    headers: { Authorization: getTwilioAuthHeader() },
  });

  if (response.ok || response.status === 404) return;
  throw new Error(`Twilio recording delete failed with status ${response.status}`);
}
