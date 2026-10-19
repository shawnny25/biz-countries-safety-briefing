// scripts/update.mjs — 뉴스 헤드라인(무료 RSS) → Gemini 1회 호출 → index.html 재생성
// 실패하면 기존 index.html을 그대로 두고 정상 종료한다(실패 알림 메일이 가지 않도록).
import fs from "node:fs";

const MODEL = "gemini-3.8-flash"; // 무료 한도가 바뀌면 여기만 교체

// level은 외교부/미 국무부 공식 등급을 보고 직접 수정 (AI에게 맡기지 않음)
const COUNTRIES = [
  { region: "아프리카", ko: "잠비아", en: "Zambia", flag: "🇿🇲", level: 1 },
  { region: "아프리카", ko: "케냐", en: "Kenya", flag: "🇰🇪", level: 2 },
  { region: "아프리카", ko: "에티오피아", en: "Ethiopia", flag: "🇪🇹", level: 3 },
  { region: "아프리카", ko: "우간다", en: "Uganda", flag: "🇺🇬", level: 4 },
  { region: "아프리카", ko: "말라위", en: "Malawi", flag: "🇲🇼", level: 2 },
  { region: "아시아", ko: "베트남", en: "Vietnam", flag: "🇻🇳", level: 1 },
  { region: "아시아", ko: "인도", en: "India", flag: "🇮🇳", level: 2 },
  { region: "아시아", ko: "라오스", en: "Laos", flag: "🇱🇦", level: 1 },
  { region: "아시아", ko: "필리핀", en: "Philippines", flag: "🇵🇭", level: 2 },
  { region: "아시아", ko: "방글라데시", en: "Bangladesh", flag: "🇧🇩", level: 2 },
  { region: "아시아", ko: "키르기스스탄", en: "Kyrgyzstan", flag: "🇰🇬", level: 1 },
  { region: "중남미·카리브", ko: "페루", en: "Peru", flag: "🇵🇪", level: 2 },
  { region: "중남미·카리브", ko: "도미니카공화국", en: "Dominican Republic", flag: "🇩🇴", level: 2 },
  { region: "중동", ko: "요르단", en: "Jordan", flag: "🇯🇴", level: 3 },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function headlines(en) {
  const q = encodeURIComponent(`${en} (security OR protest OR attack OR conflict OR outbreak OR advisory) when:7d`);
  const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  if (!res.ok) throw new Error(`RSS ${en}: ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
    .slice(0, 8)
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}

async function summarize(news) {
  const body = COUNTRIES.map((c) => `## ${c.ko}\n${news[c.ko].map((t) => "- " + t).join("\n")}`).join("\n\n");
  const prompt = `해외 출장 안전 담당자를 위한 국가별 브리핑을 작성하세요.
아래 최근 7일 뉴스 헤드라인에 근거한 내용만 쓰고, 헤드라인에 없는 내용은 추측하지 마세요.
국가마다 한국어 bullets 2~4개(각 한 문장), health(보건·질병 이슈가 헤드라인에 있을 때만 한 문장, 없으면 ""),
alert(출장 판단에 영향을 주는 긴급 변화가 있을 때만 한 문장, 없으면 "")를 작성합니다.
특이사항이 없으면 bullets에 "최근 7일간 특이 동향 보도 없음" 한 줄만 넣으세요.
JSON 객체로만 답하고 키는 국가명(한국어)입니다. 형식: {"잠비아":{"bullets":[""],"health":"","alert":""}}

${body}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${await res.text()}`);
  const data = JSON.parse((await res.json()).candidates[0].content.parts[0].text);
  for (const c of COUNTRIES) {
    if (!Array.isArray(data[c.ko]?.bullets) || !data[c.ko].bullets.length) throw new Error(`요약 누락: ${c.ko}`);
  }
  return data;
}

function card(c, s) {
  const alert = s.alert ? `\n    <div class="alert-note">⚠ ${esc(s.alert)}</div>` : "";
  const health = s.health ? `\n    <div class="health-note">🦠 ${esc(s.health)}</div>` : "";
  return `  <div class="card">
    <h3>${c.flag} ${c.ko}</h3>
    <div class="badges">
      <span class="badge level${c.level}">Lv.${c.level}</span>${s.alert ? '\n      <span class="badge watch">⚠ 긴급 변화</span>' : ""}
    </div>
    <ul>
${s.bullets.map((b) => `      <li>${esc(b)}</li>`).join("\n")}
    </ul>${alert}${health}
  </div>`;
}

async function main() {
  const news = {};
  for (const c of COUNTRIES) news[c.ko] = await headlines(c.en);
  const summary = await summarize(news);

  const style = fs.readFileSync("index.html", "utf8").match(/<style>[\s\S]*?<\/style>/)[0]; // 기존 디자인 재사용
  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const regions = [...new Set(COUNTRIES.map((c) => c.region))];
  const sections = regions
    .map((r) => `  <div class="region-title">${r}</div>\n  <div class="region-grid">\n${COUNTRIES.filter((c) => c.region === r).map((c) => card(c, summary[c.ko])).join("\n")}\n  </div>`)
    .join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>사업국가 출장 안전·정세 브리핑</title>
${style}
</head>
<body>
  <h1>🛡️ 사업국가 출장 안전·정세 브리핑</h1>
  <div class="meta">${today} 기준 · 매일 오전 7시 자동 갱신</div>
  <div class="source">최근 7일 뉴스 헤드라인(Google News)을 AI(Gemini)가 요약한 내용이며, 등급(Lv)은 공식 여행경보를 참고해 수동 관리합니다.</div>
  <div class="legend">
    <span class="lv1"><span class="dot"></span>Lv.1 평시 주의</span>
    <span class="lv2"><span class="dot"></span>Lv.2 주의 강화</span>
    <span class="lv3"><span class="dot"></span>Lv.3 여행 재고</span>
    <span class="lv4"><span class="dot"></span>Lv.4 여행 금지</span>
  </div>

${sections}

  <footer>AI 요약은 오류가 있을 수 있습니다. 최종 출장 결정은 외교부 해외안전여행(0404.go.kr) 및 사내 안전관리 절차에 따라 판단하세요.</footer>
</body>
</html>
`;
  fs.writeFileSync("index.html", html);
  console.log("index.html 갱신 완료");
}

main().catch((e) => {
  console.error("갱신 실패 — 기존 index.html 유지:", e.message);
  process.exit(0); // 의도적: 실패해도 워크플로우를 성공 처리해 GitHub 실패 메일을 막는다
});
