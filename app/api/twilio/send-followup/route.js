import { NextResponse } from "next/server";
import { db } from "../../../../lib/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import twilio from "twilio";
import OpenAI from "openai";

async function getMissedCallDocument(call_sid, retries = 3, delay = 1000) {
  console.log(
    `⏳ Waiting before fetching missed call document (${call_sid})...`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Buffer

  for (let i = 0; i < retries; i++) {
    const missedCallQuery = query(
      collection(db, "missed_calls"),
      where("call_sid", "==", call_sid)
    );
    const missedCallSnap = await getDocs(missedCallQuery);

    if (!missedCallSnap.empty) {
      console.log(`✅ Missed call document found on attempt ${i + 1}`);
      return missedCallSnap.docs[0];
    }

    console.warn(`🔄 Retry ${i + 1}: Missed call doc not found`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return null;
}

// Twilio setup
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilio_phone_number = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(accountSid, authToken);

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// PGU brand context
const brandContext = `
HOW WE'RE DIFFERENT:
- We don't just scrimmage. We create relationships and ensure athletes leave with drills and a plan to improve.
- Every athlete stays involved, has fun, and creates lifelong memories.
- We cap attendance so every player gets individual attention and coaching.
- We operate with a clear game plan—weekly, daily, and hourly—with intentional, high-quality instruction.
- Our motto is "Today Is Someone’s Favorite Memory"—and we live by it.

OUR IMPACT:
- Since 2017, nearly 10,000 campers have trained with us.
- We’ve helped over 250 athletes attend camps they couldn’t otherwise afford—thanks to our sponsors.
- We host free clinics in Kansas, Indiana, and Chicago each winter.
- We give back thousands of dollars annually to local athletic clubs, schools, and communities.
`;

export async function POST(req) {
  try {
    const textBody = await req.text();
    if (!textBody) {
      return NextResponse.json(
        { error: "Empty request body" },
        { status: 400 }
      );
    }

    const data = JSON.parse(textBody);
    const { patient_number, twilio_phone_number, call_sid, clinic_name } = data;

    if (!patient_number || !twilio_phone_number || !call_sid || !clinic_name) {
      return NextResponse.json(
        { error: "Missing required data" },
        { status: 400 }
      );
    }

    console.log(`📌 Preparing follow-up SMS for ${clinic_name}...`);

    // Get Firestore booking URL & delay
    const q = query(
      collection(db, "dentists"),
      where("twilio_phone_number", "==", twilio_phone_number)
    );
    const snap = await getDocs(q);

    let bookingUrl = "";
    let followUpDelayInSeconds = 1;

    if (!snap.empty) {
      const dentistData = snap.docs[0].data();
      bookingUrl = dentistData.booking_url || "";
      followUpDelayInSeconds = (dentistData.follow_up_delay || 0) * 60;
    }

    // Generate AI message using PGU tone
    let aiMessage = "";
    try {
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are writing as Nick, the Point Guard U virtual assistant, responding to a missed call.
        
        Always start with:
        "What’s up! Nick here, your Point Guard U virtual assistant."
        
        Here’s some background context to guide your tone:
        ${brandContext}
        
        Important writing rules:
        - Be very brief and natural, like texting a parent.
        - Write in 1–2 short sentences max.
        - Never say “amazing” or use overly cheesy words.
        - Focus on encouraging registration for camp (don’t mention private training unless asked).
        - Use the term “registration link” (not “booking link”).
        - Always include this at the end: www.pgucamps.com
        - Don’t apologize for the missed call — be upbeat and helpful.
        - Never write long paragraphs.`,
          },
          {
            role: "user",
            content:
              "The parent called but missed us. Send a short follow-up message.",
          },
        ],
        max_tokens: 100,
      });

      aiMessage = aiResponse.choices[0].message.content.trim();
    } catch (err) {
      console.error("❌ OpenAI Error:", err);
      throw err;
    }

    console.log(`🤖 AI Message Ready: ${aiMessage}`);

    // Send SMS after delay
    console.log(`⏳ Delaying follow-up for ${followUpDelayInSeconds}s...`);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // test delay: 1s

    await client.messages.create({
      body: aiMessage,
      from: twilio_phone_number,
      to: patient_number,
    });

    console.log(`📤 Follow-up SMS sent to ${patient_number}`);

    // Update Firestore
    const missedCallSnap = await getMissedCallDocument(call_sid);
    if (!missedCallSnap || !missedCallSnap.exists()) {
      console.warn("⚠️ Fallback: direct fetch of missed call doc");
      const fallbackQuery = query(
        collection(db, "missed_calls"),
        where("call_sid", "==", call_sid)
      );
      const fallbackSnap = await getDocs(fallbackQuery);

      if (!fallbackSnap.empty) {
        const docId = fallbackSnap.docs[0].id;
        await updateDoc(doc(db, "missed_calls", docId), {
          follow_up_status: "Completed",
          ai_message: aiMessage,
          ai_message_timestamp: new Date(),
          ai_message_status: "sent",
        });
        console.log(`✅ Firestore updated using fallback for ${call_sid}`);
      } else {
        console.warn("❌ Could not find missed call document at all.");
      }
    } else {
      const docId = missedCallSnap.id;
      await updateDoc(doc(db, "missed_calls", docId), {
        follow_up_status: "Completed",
        ai_message: aiMessage,
        ai_message_timestamp: new Date(),
        ai_message_status: "sent",
      });
      console.log(`✅ Firestore updated for ${call_sid}`);
    }

    return NextResponse.json({
      success: true,
      message: "Follow-up SMS sent & Firestore updated!",
    });
  } catch (error) {
    console.error("❌ Error in follow-up handler:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
