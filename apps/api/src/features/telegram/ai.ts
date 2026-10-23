// import { GoogleGenAI } from "@google/genai"; // @google/genai not bundled - using fallback
import { logger } from "../../shared/logger";

let _ai: any = null;

function getAI(): any {
  if (_ai) return _ai;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) return null;
  _ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  return _ai;
}

const DAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Fallback basa-basi per day of week
const BASA_BASI_FALLBACK: Record<number, string> = {
  0: "Selamat hari Minggu kak! Sambil recharge, tidak ada salahnya siapkan strategi untuk minggu depan ya. 😊",
  1: "Selamat memulai minggu baru kak! Semoga minggu ini jadi minggu dengan closing terbanyak. 🚀",
  2: "Happy Tuesday kak! Yuk manfaatkan energi tengah minggu untuk kejar LOP yang masih pending. 💪",
  3: "Selamat hari Rabu kak! Sudah setengah minggu — waktunya cek progress dan pastikan target tetap on track. 📊",
  4: "Hampir akhir minggu kak! Yuk sprint habis-habisan, jangan ada peluang yang terlewat sebelum weekend. 🏃",
  5: "Happy Friday kak! Jadikan Jumat ini penuh pencapaian — tutup minggu dengan closing yang manis. 🎯",
  6: "Weekend nih kak, tapi rezeki nggak mengenal hari! Kalau ada prospek yang bisa difollow-up, jangan ditunda ya. 😄",
};

// Generate a warm, contextual basa-basi opener using AI
export async function generateBasaBasi(namaLengkap: string): Promise<string> {
  const ai = getAI();
  const now = new Date();
  const day = now.getDay();
  const dayName = DAYS_ID[day];
  const hour = now.getHours();

  if (!ai) return BASA_BASI_FALLBACK[day] || BASA_BASI_FALLBACK[1];

  const prompt = [
    `Kamu adalah BOT LESA VI, asisten AM (Account Manager) di Telkom Witel Suramadu.`,
    `Sekarang hari ${dayName}, pukul ${hour}.00.`,
    `Kamu menyapa AM bernama "${namaLengkap}".`,
    ``,
    `Tulis basa-basi pembuka yang hangat dan kontekstual — 1-2 kalimat saja.`,
    `Bisa berupa pantun singkat, kata-kata motivasi relevan dengan hari ini, atau sapaan unik.`,
    `Sesuaikan dengan suasana hari (hari kerja/weekend, pagi/siang/malam).`,
    `Bahasa Indonesia santai dan akrab, pakai "kak" untuk menyapa.`,
    `Jangan mulai dengan kata "Halo", "Hai", "Hi", atau sapaan serupa — langsung ke inti basa-basi.`,
    `Jangan gunakan markdown atau simbol berlebihan. Maksimal 30 kata.`,
  ].join("\n");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 300 },
    });
    const text = response.text?.trim();
    // Guard against truncated responses (less than 15 chars = something went wrong)
    return (text && text.length >= 15) ? text : BASA_BASI_FALLBACK[day];
  } catch (err) {
    logger.debug({ err }, "Gemini basa-basi error (non-fatal)");
    return BASA_BASI_FALLBACK[day] || BASA_BASI_FALLBACK[1];
  }
}

// Generate AI-permak'd performance feedback, with fallback
export async function generatePerfFeedback(
  firstName: string,
  achCm: number,
  rankCm: number,
  totalAMs: number,
  monthName: string,
  year: number,
  fallback: string,
): Promise<string> {
  const ai = getAI();
  if (!ai) return fallback;

  const prompt = [
    `Kamu adalah BOT LESA VI, asisten AM di Telkom Witel Suramadu.`,
    `AM bernama "${firstName}" punya performa berikut untuk periode ${monthName} ${year}:`,
    `- Pencapaian Revenue CM (Current Month): ${achCm.toFixed(2)}%`,
    `- Ranking CM: #${rankCm} dari ${totalAMs} AM Witel Suramadu`,
    ``,
    `Tulis feedback performansi yang:`,
    `- Personal dan memotivasi sesuai posisi ranking dan pencapaiannya`,
    `- Tidak generik atau terasa template`,
    `- Bahasa Indonesia santai, akrab, pakai sapaan "kak"`,
    `- Boleh selipkan pantun pendek atau humor sales yang relevan`,
    `- Jangan mulai dengan "Halo" atau "Hai"`,
    `- Maksimal 3 kalimat`,
  ].join("\n");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 400 },
    });
    const text = response.text?.trim();
    // Guard against truncated responses
    return (text && text.length >= 20) ? text : fallback;
  } catch (err) {
    logger.debug({ err }, "Gemini perf feedback error (non-fatal)");
    return fallback;
  }
}

// Funnel motivation fallbacks
const FUNNEL_STAGNAN_FALLBACK =
  `Kak, LOP-LOP di atas tercatat belum ada pergerakan status sejak data sebelumnya. ` +
  `Mohon segera dicek kembali apakah statusnya memang masih di situ atau sudah ada perkembangan yang belum terinput ya kak. ` +
  `Jangan dibiarkan stagnan terlalu lama — segera dorong ke funnel berikutnya supaya makin dekat ke F5 dan bonus segera cair! 💰 ` +
  `Semangat kak, kamu pasti bisa! 💪`;

const FUNNEL_ALL_MOVING_FALLBACK =
  `Luar biasa kak! Semua LOP kakak tercatat ada pergerakan status dibanding data sebelumnya. ` +
  `Pertahankan momentum ini dan terus dorong hingga F5 ya kak! Bonus menanti! 💰`;

export async function generateFunnelMotivation(
  namaLengkap: string,
  stagnanCount: number,
  allMoving: boolean,
): Promise<string> {
  const ai = getAI();

  if (allMoving) {
    if (!ai) return FUNNEL_ALL_MOVING_FALLBACK;
    const prompt = [
      `Kamu adalah BOT LESA VI, asisten AM di Telkom Witel Suramadu.`,
      `AM bernama "${namaLengkap}" baru saja dikirim laporan funneling dan semua LOP-nya bergerak (ada perubahan status).`,
      `Tulis apresiasi singkat yang hangat dan memotivasi — 2-3 kalimat saja.`,
      `Dorong AM untuk terus mempertahankan momentum hingga F5/Win supaya bonus cair.`,
      `Bahasa Indonesia santai dan akrab, pakai sapaan "kak".`,
      `Jangan mulai dengan "Halo" atau "Hai". Format teks biasa, tanpa markdown berlebihan.`,
    ].join("\n");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 200 },
      });
      const text = response.text?.trim();
      return (text && text.length >= 15) ? text : FUNNEL_ALL_MOVING_FALLBACK;
    } catch (err) {
      logger.debug({ err }, "Gemini funnel motivation (all-moving) error (non-fatal)");
      return FUNNEL_ALL_MOVING_FALLBACK;
    }
  } else {
    if (!ai) return FUNNEL_STAGNAN_FALLBACK;
    const prompt = [
      `Kamu adalah BOT LESA VI, asisten AM di Telkom Witel Suramadu.`,
      `AM bernama "${namaLengkap}" memiliki ${stagnanCount} LOP yang belum bergerak status-nya dari snapshot sebelumnya.`,
      `Tulis pesan tegas namun tetap supportif — 2-3 kalimat saja.`,
      `Ingatkan bahwa LOP stagnan berisiko hangus dan bonus tidak akan cair jika tidak ada pergerakan.`,
      `Dorong AM untuk segera mengambil tindakan nyata.`,
      `Bahasa Indonesia santai dan akrab, pakai sapaan "kak".`,
      `Jangan mulai dengan "Halo" atau "Hai". Format teks biasa, tanpa markdown berlebihan.`,
    ].join("\n");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 200 },
      });
      const text = response.text?.trim();
      return (text && text.length >= 15) ? text : FUNNEL_STAGNAN_FALLBACK;
    } catch (err) {
      logger.debug({ err }, "Gemini funnel motivation (stagnan) error (non-fatal)");
      return FUNNEL_STAGNAN_FALLBACK;
    }
  }
}

// AI chat for general messages
export async function chatWithGemini(
  userMessage: string,
  context: { amName?: string; divisi?: string }
): Promise<string | null> {
  const ai = getAI();
  if (!ai) return null;

  const now = new Date();
  const dayName = DAYS_ID[now.getDay()];
  const hour = now.getHours();

  const lines = [
    `Kamu adalah BOT LESA VI, asisten pintar sales AM di Telkom Witel Suramadu TREG 3.`,
    `Hari ini hari ${dayName}, pukul ${hour}.00.`,
    context.amName
      ? `Kamu sedang ngobrol dengan AM bernama ${context.amName}${context.divisi ? ` dari Divisi ${context.divisi}` : ""}.`
      : `Kamu sedang ngobrol dengan pengguna yang belum terhubung ke sistem.`,
    ``,
    `Panduan respons:`,
    `- Singkat dan hangat, maksimal 4 kalimat.`,
    `- Bahasa Indonesia santai tapi sopan, pakai sapaan "kak".`,
    `- Boleh beri pantun atau humor ringan yang relevan dengan hari atau konteks.`,
    `- Sesekali selipkan semangat untuk mengejar target, prospek baru, atau pergerakan LOP.`,
    `- Jangan jawab hal di luar dunia sales/telekomunikasi/pekerjaan.`,
    `- Format teks biasa, tidak perlu markdown berlebihan.`,
  ];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: { systemInstruction: lines.join("\n"), maxOutputTokens: 200 },
    });
    const text = response.text?.trim();
    return text || null;
  } catch (err) {
    logger.debug({ err }, "Gemini chat error (non-fatal)");
    return null;
  }
}
