import { google } from "googleapis";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const TOKEN_PATH = path.join(process.cwd(), "calendar-tokens.json");

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/calendar/callback",
  );
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });
}

export async function handleCallback(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  await writeFile(TOKEN_PATH, JSON.stringify(tokens));
  return tokens;
}

async function getAuthenticatedClient() {
  const client = getOAuth2Client();
  const tokenData = await readFile(TOKEN_PATH, "utf-8");
  client.setCredentials(JSON.parse(tokenData));
  return client;
}

interface MealEvent {
  summary: string;
  description: string;
  date: string;
  mealSlot: string;
}

export async function createMealEvent(event: MealEvent): Promise<string> {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const hour = event.mealSlot === "lunch" ? 12 : event.mealSlot === "breakfast" ? 8 : 18;

  const start = new Date(`${event.date}T${String(hour).padStart(2, "0")}:00:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  return res.data.id!;
}

export async function updateMealEvent(eventId: string, event: Partial<MealEvent>) {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const updateData: any = {};
  if (event.summary) updateData.summary = event.summary;
  if (event.description) updateData.description = event.description;

  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: updateData,
  });
}

export async function deleteMealEvent(eventId: string) {
  const auth = await getAuthenticatedClient();
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: "primary",
    eventId,
  });
}
