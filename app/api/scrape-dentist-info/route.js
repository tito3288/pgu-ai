import axios from "axios";
import * as cheerio from "cheerio";
import { admin } from "../../../lib/firebaseAdmin";
import { NextResponse } from "next/server";

// ✅ Scrapes the FAQ section from a given PGU FAQ page
export async function scrapeAndStorePGUFAQ(website_url, projectId) {
  try {
    const { data } = await axios.get(website_url);
    const $ = cheerio.load(data);

    const faqs = [];

    const allParagraphs = $("p").toArray();

    for (let i = 0; i < allParagraphs.length; i++) {
      const current = $(allParagraphs[i]);
      const isBold =
        current.find("span[style*='font-weight:bold']").length > 0 ||
        current.find("strong").length > 0;

      const question = current.text().trim();

      if (isBold && question.length > 5 && question.endsWith("?")) {
        // Look ahead for the next non-empty paragraph as the answer
        let answer = "";
        for (let j = i + 1; j < allParagraphs.length; j++) {
          const nextText = $(allParagraphs[j]).text().trim();
          if (nextText && nextText.length > 10) {
            answer = nextText;
            break;
          }
        }

        if (answer) {
          faqs.push({ question, answer });
        }
      }
    }

    console.log(`✅ Found ${faqs.length} FAQs from ${website_url}`);

    await admin
      .firestore()
      .collection("dentists") // If you're still using this collection name
      .doc(projectId)
      .set(
        {
          scraped_data: {
            faq: faqs,
            last_scraped: new Date().toISOString(),
          },
        },
        { merge: true }
      );

    console.log(`✅ Scraped and saved to Firestore: ${projectId}`);
  } catch (error) {
    console.error("❌ Error scraping FAQ:", error.message);
    throw error;
  }
}

// ✅ API route handler for POST requests
export async function POST(req) {
  try {
    const body = await req.json(); // ✅ read once
    console.log("🧪 Incoming POST body:", body);

    const { website_url, dentist_id } = body;

    if (!website_url || !dentist_id) {
      console.warn("⚠️ Missing required fields:", { website_url, dentist_id });
      return NextResponse.json(
        { error: "Missing website_url or dentist_id" },
        { status: 400 }
      );
    }

    await scrapeAndStorePGUFAQ(website_url, dentist_id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("❌ API POST error:", err);
    return NextResponse.json({ error: "Scraping failed" }, { status: 500 });
  }
}
