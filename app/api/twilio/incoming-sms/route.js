import { NextResponse } from "next/server";
import { db } from "../../../../lib/firebaseConfig";
import OpenAI from "openai";
import twilio from "twilio";
import { parse } from "querystring";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  Timestamp,
  orderBy,
  limit,
} from "firebase/firestore";

// Twilio setup
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  const body = await req.text();
  const data = parse(body);

  const from = data.From;
  const to = data.To;
  const messageBody = data.Body;

  console.log(`📥 Received message from ${from}: "${messageBody}"`);

  // 🔍 Pull clinic/camp info from Firestore
  let clinic_name = "the camp team";
  let booking_url = "";
  let services = "";
  let hours = "";
  let address = "";
  let faq_entries = [];

  const dentistQuery = query(
    collection(db, "dentists"),
    where("twilio_phone_number", "==", to)
  );
  const dentistSnap = await getDocs(dentistQuery);
  if (!dentistSnap.empty) {
    const docData = dentistSnap.docs[0].data();
    clinic_name = docData.clinic_name ?? docData.name ?? clinic_name;
    booking_url = docData.booking_url ?? "";
    const scraped = docData.scraped_data ?? {};
    services = Array.isArray(scraped.services)
      ? scraped.services.join(", ")
      : scraped.services;
    hours = scraped.hours ?? "";
    address = scraped.address ?? "";
    faq_entries = scraped.faq ?? [];
  }

  // 🤖 Generate AI reply
  try {
    const systemPrompt = `You are a friendly and helpful virtual receptionist for ${clinic_name}. 
Use the FAQ info below to help answer questions from parents or players:

${faq_entries
  .map((item, i) => `Q${i + 1}: ${item.question}\nA${i + 1}: ${item.answer}`)
  .join("\n\n")}

Other useful info:
- Address: ${address || "not provided"}
- Hours: ${hours || "not available"}
- Services: ${services || "basketball camps"}
- Booking URL: ${booking_url || "no link provided"}

Always encourage users to book online when appropriate: ${booking_url}.
If they ask about cost, dates, locations, or rules — the answers should already be in the FAQ above.`;

    const aiReply = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: messageBody,
        },
      ],
      max_tokens: 300,
    });

    const replyText = aiReply.choices[0].message.content.trim();
    console.log(`🤖 Replying with: ${replyText}`);

    await client.messages.create({
      from: to,
      to: from,
      body: replyText,
    });

    // 🔄 Find the most recent missed call document for this phone pair
    const callQuery = query(
      collection(db, "missed_calls"),
      where("patient_number", "==", from),
      where("dentist_phone_number", "==", to),
      orderBy("timestamp", "desc"),
      limit(1)
    );

    const callSnap = await getDocs(callQuery);
    if (!callSnap.empty) {
      const callDoc = callSnap.docs[0];
      const call_sid = callDoc.id;

      const convoRef = collection(
        db,
        "missed_calls",
        call_sid,
        "conversations"
      );

      // ✅ Duplicate prevention logic
      const recentMessagesQuery = query(
        convoRef,
        orderBy("timestamp", "desc"),
        limit(1)
      );

      const recentMessagesSnap = await getDocs(recentMessagesQuery);
      const lastMsg = recentMessagesSnap.docs[0]?.data()?.message;

      if (lastMsg !== messageBody) {
        const now = Timestamp.now();

        await addDoc(convoRef, {
          from: "user",
          message: messageBody,
          timestamp: now,
          sequence: 1,
        });

        await addDoc(convoRef, {
          from: "ai",
          message: replyText,
          timestamp: now,
          sequence: 2,
        });
      } else {
        console.log("🛑 Duplicate message detected. Skipping Firestore log.");
      }
    } else {
      console.warn(
        "⚠️ No matching missed_calls doc found to log conversation."
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Error in AI reply handler:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
