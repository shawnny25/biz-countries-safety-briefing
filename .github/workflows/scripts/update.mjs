// scripts/update.mjs
// 매일 GitHub Actions가 이 스크립트를 실행해 index.html을 새로 생성합니다.

const COUNTRIES = [
  { region: "아프리카", name: "잠비아", flag: "🇿🇲", partner: "" },
  { region: "아프리카", name: "말라위", flag: "🇲🇼", partner: "MYI" },
  { region: "아프리카", name: "케냐", flag: "🇰🇪", partner: "GCS" },
  { region: "아프리카", name: "에티오피아", flag: "🇪🇹", partner: "" },
  { region: "아프리카", name: "우간다", flag: "🇺🇬", partner: "" },
  // 필요에 따라 국가를 여기에 추가/삭제하세요
];

const SYSTEM_PROMPT = `당신은 국제개발협력 기관의 출장 안전 브리핑 담당자입니다.
주어진 국가에 대해 최신 안전등급(Lv.1 평시주의/Lv.2 주의강화/Lv.3 여행재고/Lv.4 여행금지)과
정치·치안 이슈, 보건(질병) 이슈를 조사해서 한국어로 간결하게 정리하세요.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

{
  "level": "1" | "2" | "3" | "4",
  "bullets": ["이슈 요약 문장 1", "이슈 요약 문장 2", "이슈 요약 문장 3"],
  "health_note": "CDC 등 보건 경보가 있다면 한 문장, 없으면 빈 문자열"
}`;

async function fetchCountryBriefing(country) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${country.name}(${country.flag})의 오늘 기준 출장 안전 브리핑을 만들어주세요. Reuters, AP, BBC, 각국 정부 여행경보, CDC 여행건강경보를 참고하세요.`,
        },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error(`${country.name}: 응답에 텍스트 블록 없음`);

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

const LEVEL_META = {
  1: { label: "Lv.1 평시 주의", color: "#22c55e" },
  2: { label: "Lv.2 주의 강화", color: "#eab308" },
  3: { label: "Lv.3 여행 재고", color: "#f97316" },
  4: { label: "Lv.4 여행 금지", color: "#ef4444" },
};

function renderCountryCard(country, briefing) {
  const meta = LEVEL_META[briefing.level] || LEVEL_META[1];
  const bulletHtml = briefing.bullets
    .map((b) => `<li>${b}</li>`)
    .join("\n            ");
  const healthHtml = briefing.health_note
    ? `<div class="health-note">🦠 ${briefing.health_note}</div>`
    : "";

  return `
    <div class="card">
      <h3>${country.flag} ${country.name}</h3>
      <span class="badge" style="background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}">${meta.label}</span>
      <ul>
            ${bulletHtml}
      </ul>
      ${healthHtml}
    </div>`;
}

function renderPage(sections, todayStr) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>사업국가 출장 안전·정세 브리핑</title>
<style>
  body { background:#0d0d0f; color:#f5f5f5; font-family: -apple-system, 'Apple SD Gothic Neo', sans-serif; max-width:900px; margin:0 auto; padding:24px; }
  h1 { text-align:center; }
  .meta { text-align:center; color:#9ca3af; font-size:14px; margin-bottom:32px; }
  .region-title { font-size:22px; font-weight:700; margin:32px 0 12px; border-bottom:1px solid #333; padding-bottom:8px; }
  .card { background:#18181b; border-radius:12px; padding:20px; margin-bottom:16px; }
  .badge { display:inline-block; padding:4px 12px; border-radius:999px; font-size:13px; margin:8px 0; }
  ul { padding-left:20px; line-height:1.6; }
  .health-note { margin-top:12px; padding:12px; background:#1e1b3a; border:1px solid #4c1d95; border-radius:8px; font-size:14px; }
</style>
</head>
<body>
  <h1>🛡️ 사업국가 출장 안전·정세 브리핑</h1>
  <div class="meta">${todayStr} 기준 · 매일 오전 7시 자동 갱신<br>기준 매체: Reuters · AP · BBC News, 미 국무부/각국 정부 여행경보, CDC 여행건강경보</div>
  ${sections}
</body>
</html>`;
}

async function main() {
  const today = new Date();
  const todayStr = today.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });

  const byRegion = {};
  for (const country of COUNTRIES) {
    console.log(`조사 중: ${country.name}`);
    const briefing = await fetchCountryBriefing(country);
    (byRegion[country.region] ||= []).push(renderCountryCard(country, briefing));
  }

  const sectionsHtml = Object.entries(byRegion)
    .map(([region, cards]) => `
  <div class="region-title">${region}</div>
  ${cards.join("\n")}`)
    .join("\n");

  const html = renderPage(sectionsHtml, todayStr);
  const fs = await import("node:fs/promises");
  await fs.writeFile("index.html", html, "utf-8");
  console.log("index.html 갱신 완료");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
