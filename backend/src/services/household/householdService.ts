import { getDb } from "../db/supabase.js";
import { randomBytes } from "crypto";

function randomJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += chars[randomBytes(1)[0]! % chars.length];
  }
  return s;
}

export async function getHouseholdIdForUser(userId: string): Promise<string | null> {
  const sb = getDb();
  const { data, error } = await sb
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.household_id ?? null;
}

/** All member user IDs in the same household as `userId`, or `[userId]` if none. */
export async function resolveHouseholdUserIds(userId: string): Promise<string[]> {
  const hid = await getHouseholdIdForUser(userId);
  if (!hid) return [userId];
  const sb = getDb();
  const { data, error } = await sb
    .from("household_members")
    .select("user_id")
    .eq("household_id", hid);
  if (error) throw error;
  const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
  return ids.length > 0 ? ids : [userId];
}

export async function createHousehold(userId: string, name?: string): Promise<{
  householdId: string;
  joinCode: string;
  name: string;
}> {
  const existing = await getHouseholdIdForUser(userId);
  if (existing) {
    throw new Error("You already belong to a household. Leave it before creating a new one.");
  }
  const sb = getDb();
  let joinCode = randomJoinCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: h, error: insErr } = await sb
      .from("households")
      .insert({
        name: name?.trim() || "Household",
        join_code: joinCode,
        created_by: userId,
      })
      .select("id")
      .single();
    if (!insErr && h) {
      const { error: memErr } = await sb.from("household_members").insert({
        household_id: h.id,
        user_id: userId,
        role: "owner",
      });
      if (memErr) throw memErr;
      return {
        householdId: h.id as string,
        joinCode,
        name: name?.trim() || "Household",
      };
    }
    if (insErr && !String(insErr.message).toLowerCase().includes("duplicate")) {
      throw insErr;
    }
    joinCode = randomJoinCode();
  }
  throw new Error("Could not generate a unique join code. Try again.");
}

export async function joinHousehold(userId: string, joinCode: string): Promise<{ householdId: string }> {
  const code = joinCode.trim().toUpperCase();
  if (code.length < 6) throw new Error("Invalid join code.");

  const existing = await getHouseholdIdForUser(userId);
  if (existing) {
    throw new Error("You already belong to a household.");
  }

  const sb = getDb();
  const { data: h, error: findErr } = await sb
    .from("households")
    .select("id")
    .ilike("join_code", code)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!h) throw new Error("No household found for that code.");

  const { error: memErr } = await sb.from("household_members").insert({
    household_id: h.id,
    user_id: userId,
    role: "member",
  });
  if (memErr) throw memErr;
  return { householdId: h.id as string };
}

export async function leaveHousehold(userId: string): Promise<{ left: boolean }> {
  const hid = await getHouseholdIdForUser(userId);
  if (!hid) {
    throw new Error("You are not in a household.");
  }
  const sb = getDb();
  const { error: delErr } = await sb.from("household_members").delete().eq("user_id", userId);
  if (delErr) throw delErr;
  const { data: remaining, error: cntErr } = await sb
    .from("household_members")
    .select("user_id")
    .eq("household_id", hid);
  if (cntErr) throw cntErr;
  if (!remaining?.length) {
    const { error: hErr } = await sb.from("households").delete().eq("id", hid);
    if (hErr) throw hErr;
  }
  return { left: true };
}

export async function renameHousehold(userId: string, name: string): Promise<{ name: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");
  const hid = await getHouseholdIdForUser(userId);
  if (!hid) {
    throw new Error("You are not in a household.");
  }
  const sb = getDb();
  const { data: mem, error: mErr } = await sb
    .from("household_members")
    .select("role")
    .eq("user_id", userId)
    .eq("household_id", hid)
    .maybeSingle();
  if (mErr) throw mErr;
  if ((mem?.role as string) !== "owner") {
    throw new Error("Only the household owner can rename it.");
  }
  const { error: uErr } = await sb.from("households").update({ name: trimmed }).eq("id", hid);
  if (uErr) throw uErr;
  return { name: trimmed };
}

export async function getHouseholdSummary(userId: string): Promise<{
  inHousehold: boolean;
  householdId: string | null;
  name: string | null;
  joinCode: string | null;
  memberIds: string[];
}> {
  const hid = await getHouseholdIdForUser(userId);
  if (!hid) {
    return { inHousehold: false, householdId: null, name: null, joinCode: null, memberIds: [userId] };
  }
  const sb = getDb();
  const { data: hh, error: hErr } = await sb
    .from("households")
    .select("name, join_code")
    .eq("id", hid)
    .single();
  if (hErr) throw hErr;
  const memberIds = await resolveHouseholdUserIds(userId);
  return {
    inHousehold: true,
    householdId: hid,
    name: (hh?.name as string) ?? null,
    joinCode: (hh?.join_code as string) ?? null,
    memberIds,
  };
}
