"use server";

import { run, str, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import { UserError } from "@/lib/errors";
import { SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import * as admin from "@/services/admin";
import { runScheduledJobs } from "@/services/automation";
import { requirePerm } from "@/lib/actor";
import { parseLatLng } from "@/lib/geo";

export async function saveUserAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await admin.saveUser(actor, str(d.userId) || null, admin.userSchema.parse({ ...d, active: d.userId ? zBool.parse(d.active ?? "") : true }));
    return d.userId ? "User saved." : "User created. Share the temporary password with them securely.";
  });
}

export async function saveSettingsAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const values: Partial<Record<SettingKey, unknown>> = {};
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      const field = `s__${key}`;
      const def = SETTING_DEFAULTS[key];
      if (typeof def === "boolean") {
        if (fd.has(`${field}__present`)) values[key] = fd.get(field) === "on";
        continue;
      }
      if (!fd.has(field)) continue;
      const raw = str(d[field]);
      if (typeof def === "number") values[key] = Number(raw);
      else if (typeof def === "string") values[key] = raw;
      else if (Array.isArray(def) && ((def as readonly unknown[]).length === 0 || typeof def[0] !== "object")) {
        const list = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        values[key] = typeof def[0] === "number" ? list.map(Number) : list;
      } else {
        try {
          values[key] = JSON.parse(raw);
        } catch {
          throw new UserError(`${key} is not valid JSON.`);
        }
      }
    }
    await admin.saveSettings(actor, values);
    return "Settings saved.";
  });
}

export async function saveOrgAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const o = await admin.saveOrganization(actor, str(d.orgId) || null, admin.orgSchema.parse({ ...d, active: d.orgId ? zBool.parse(d.active ?? "") : true }));
    return d.orgId ? "Saved." : { redirectTo: `/directory/${o.id}` };
  });
}
export async function addContactAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await admin.addContact(actor, str(d.orgId), admin.contactSchema.parse(d))));
}
export async function deleteContactAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await admin.deleteContact(actor, str(d.id))));
}

export async function saveEventAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await admin.saveEvent(actor, str(d.eventId) || null, admin.eventSchema.parse({ ...d, attendeeIds: d.attendeeIds ?? [] }));
    return "Meeting saved.";
  });
}
export async function deleteEventAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await admin.deleteEvent(actor, str(d.eventId))));
}

export async function markReadAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await admin.markNotificationsRead(actor, d.all ? "all" : [str(d.id)])));
}

export async function runJobsNowAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor) => {
    requirePerm(actor, "admin.settings");
    const counts = await runScheduledJobs();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return `Reminders checked: ${total} new notification(s).`;
  });
}

export async function officeLocationAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const text = str(d.pin).trim();
    const pin = text ? parseLatLng(text) : null;
    if (text && !pin) throw new UserError("Enter the office location as latitude, longitude, for example 43.653200, -79.383200.");
    await admin.saveSettings(actor, { "field.officeAddress": str(d.address).trim(), "field.officePin": pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : "" });
    return pin ? "Office location saved." : "Office location cleared.";
  });
}
