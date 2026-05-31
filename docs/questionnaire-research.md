# 訪談 Prompt 設計 — research backing

`lib/ai/prompt.ts` 的 AI 面談 prompt 設計依據。由多 agent 文獻研究 + 引用驗證產出（51 sources，37 verified-accurate / 14 metadata-corrected / 0 fabricated）。本文件記錄 (1) 已落地的改動、(2) 建議但尚未做的、(3) 要避免的 anti-pattern、(4) 驗證過的書目。

> 原則：AI 用聊的把信號問出來、**記成 signal，不下適配判斷** —— suitability 由顧問在 phase 5-10 評。

## Executive read

現有四階段（Context / Workflow / Pain / Data）+ 一次一問 + 從寬到窄的 funnel + 問過去行為，方向正確且對齊文獻（NN/g Funnel、Mom Test、conversational-survey 證據：chatbot 比表單多收 ~39% 資訊、completion 54% vs 24%，Xiao et al. 2020）。文獻揭露的最大缺口：

1. **SML 八準則沒在 step 粒度問出來** —— 尤其漏掉 reasoning-chain 長度、需不需要解釋 why、error tolerance，以及 **ground-truth 是否有共識**（Lebovitz et al. 2021：5 個醫院 ML 工具準確率高卻全失敗，因專家對「正確答案」不一致）。feasibility 硬閘門。
2. **沒有量化 baseline** —— 下游排序需要 cost / cycle time / error rate / FTE（McKinsey 2026）。
3. **時間估計用錯方法** —— global「平常一天」有系統偏誤（Kan & Pudney 2008），拆解加總放大高估（Belli et al. 2000）；應用 DRM episode 重建（Kahneman et al. 2004）。
4. **缺 leadership / 變革史信號** —— 價值來自 organizational learning + process redesign（21%→73%，MIT-BCG 2020），非擁有 data/tech/talent。
5. **under-probe 是 AI interviewer 主要 failure mode** —— 88% 該追沒追是 AI 造成（Wuttke et al. 2024）。
6. **prediction vs. judgment 沒拆**（Agrawal-Gans-Goldfarb 2018）—— 最 actionable 的新 lens。

## 本次已落地（高 ROI 子集）

| 改動 | 位置 | 來源 |
|------|------|------|
| Prediction vs. judgment split（每 step 分「判斷 vs 執行」） | Workflow + 心裡的清單 | Agrawal-Gans-Goldfarb 2018 |
| Ground-truth 共識 probe | Data + 心裡的清單 | Lebovitz et al. 2021 |
| 量化 quad（量×頻率 / 每次時間 / 成本-FTE / 返工率） | Workflow advance 前 | McKinsey 2026；Task Mining |
| DRM episode 時間重建（取代 global 估計） | Context | Kahneman 2004；Kan & Pudney 2008；Belli 2000 |
| MUST-probe-on-vagueness + idiographic 預設 + cap probes | 全域守則 | Wuttke 2024；Jacobsen 2025；Xiao 2020 |
| C1 sponsorship + C2 change-history（輕量帶） | Context | Jöhnk 2021；MIT-BCG 2020 |
| 問法 anti-pattern 改寫（leading/declarative/forced-choice/hypothetical） | 不要做的事 | Zaremba-Liaskos 2021；Mom Test |

## 建議但尚未做（後續可挑）

- **Context**：C3 objective frame（cost-out vs growth，推斷+確認）；C4 external pressure（法規/客戶/競爭，一題）；C6 MGI 活動分類 triage。來源：McKinsey 2025；Pinto et al. 2025；MGI 2017。
- **Workflow**：W3 清楚成功標準（SML#3）；W4 reasoning-chain 長度 + 需不需要解釋 why（SML#4/#5、Eloundou 2023）；W5 Webb verb 啟發式（detect/classify/predict/extract…，Webb 2020）。
- **Pain**：P1 incident-driven（CIT/CDM，問具體壞例子而非 opinion）；P3 error-tolerance probe（SML#6）；P4 穩定性/drift（SML#7）；P5 negative-balance 反向 probe（只在敘述過度正面時用）；P6 workaround / shadow-process probe。來源：Rosala 2020；Klein 1989；Zaremba-Liaskos 2021。
- **Data**：D4 artifact-grounding（用剛走過的具體 instance 驗證）；D5 forced-choice 取代 yes-confirmation（避 acquiescence）。
- **Wrap-up**：WU1 量化 read-back 校準；WU2 E1/E2 分類（LLM-alone vs needs-a-system，Eloundou 2023）；WU3 readiness signal sheet（對齊 Jöhnk 五類，只標覆蓋度不打分）；WU4 clearinghouse probe gating（推進前問「還有什麼我沒問到」，可綁進 `tools.ts` 的 `advance_phase`）。

**長度 tradeoff**：上面多數是「融進既有 step 的一句」或「取代既有問法」，非新階段。配合 cap（每點 1-2 次追問），淨增應控制在每任務 +2~3 輪。Context 就緒度題要克制 —— C1+C2 已收，其餘列為機會性帶出。

## 要避免的 anti-pattern

1. Global/stylized 時間估計 → DRM episode 重建（Kan & Pudney 2008；DRM 2004）
2. 把估計拆成子項叫對方加總 → 放大高估，問單一具體 instance（Belli et al. 2000）
3. 模糊「最近」/ 長 reference period → 最短可行窗 + landmark 錨點（Telescoping, Lavrakas 2008）
4. Leading / declarative / forced-choice / 未來假設問型 → 開放/過去/具體（Zaremba-Liaskos 2021；Mom Test）
5. Yes/agree 確認 → forced-choice between concrete alternatives（Pew；Barari et al. 2025）
6. 抽象「為什麼」當預設 probe → idiographic「帶我走一遍」（Jacobsen et al. 2025）
7. 接受答案就往下（under-probe）→ MUST-probe-on-vagueness（Wuttke et al. 2024）
8. 用「聽起來難不難」判 AI 適配 → 只靠結構信號（八準則 + P/J split）（Dell'Acqua et al. 2023）
9. 把 ground-truth label 當客觀 → ground-truth 共識 probe（Lebovitz et al. 2021）
10. 過度 probing 不顧 completion → cap probes + completion 當一級指標（Xiao 2020；Barari 2025）

## Bibliography（verified；metadata 已修正）

**Task suitability / AI exposure**
- Brynjolfsson & Mitchell, *What can machine learning do? Workforce implications*, Science 358:1530, 2017 — https://www.cs.cmu.edu/~tom/pubs/Science_WorkforceDec2017.pdf （8 SML criteria）
- Brynjolfsson, Mitchell & Rock, *What Can Machines Learn…*, AEA P&P, 2018 — https://ide.mit.edu/sites/default/files/publications/pandp.20181019.pdf
- Agrawal, Gans & Goldfarb, *Prediction versus Judgment*, NBER WP 24626, 2018 — https://www.nber.org/system/files/working_papers/w24626/w24626.pdf
- Agrawal, Gans & Goldfarb, *A Simple Tool… (AI Canvas)*, HBR, 2018 — https://digitopoly.org/2018/04/18/a-simple-tool-to-start-making-decisions-with-the-help-of-ai/
- Eloundou, Manning, Mishkin & Rock, *GPTs are GPTs*, 2023 — https://arxiv.org/pdf/2303.10130 （E0/E1/E2）
- Felten, Raj & Seamans, *Occupational, Industry, and Geographic Exposure to AI (AIOE)*, 2021 — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3822412
- Webb, *The Impact of AI on the Labor Market*, 2020 — https://www.michaelwebb.co/webb_ai.pdf （verb-noun method）
- Lebovitz, Levina & Lifshitz-Assaf, *Is AI Ground Truth Really True?*, MISQ 45(3):1501, 2021
- Dell'Acqua et al., *Navigating the Jagged Technological Frontier*, 2023 — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4573321
- Manyika et al. (MGI), *A Future That Works*, 2017

**Interview / elicitation methods**
- Flaherty (NN/g), *Contextual Inquiry*, 2020 — https://www.nngroup.com/articles/contextual-inquiry/
- Zaremba & Liaskos, *Towards a typology of questions for requirements elicitation interviews*, IEEE RE'21 — https://www.yorku.ca/liaskos/Papers/RE2021/RE2021.pdf
- Kahneman, Krueger, Schkade, Schwarz & Stone, *Day Reconstruction Method*, Science 306:1776, 2004
- Rosala (NN/g), *The Critical Incident Technique in UX*, 2020 — https://www.nngroup.com/articles/critical-incident-technique/
- Klein, Calderwood & MacGregor, *Critical Decision Method*, IEEE Trans. SMC 19:462, 1989
- Rosala & Moran (NN/g), *The Funnel Technique in Qualitative User Research*, 2022
- Robinson, *Probing in qualitative research interviews*, Qual. Res. Psychology 20(3):382, 2023 （DICE taxonomy）
- Fitzpatrick, *The Mom Test*, 2013

**Self-report accuracy / survey design**
- Kan & Pudney, *Measurement Error in Stylized and Diary Data on Time Use*, Sociological Methodology 38:101, 2008
- Jacobs (BLS), *Measuring time at work: are self-reports accurate?*, 1998 — https://www.bls.gov/opub/mlr/1998/12/art3full.pdf
- Lavrakas (ed.), *Telescoping* (Encyclopedia of Survey Research Methods), SAGE, 2008
- Belli, Schwarz, Singer & Talarico, *Decomposition Can Harm the Accuracy of Behavioral Frequency Reports*, Applied Cognitive Psychology 14:295, 2000
- Tourangeau, Rips & Rasinski, *The Psychology of Survey Response*, Cambridge Univ. Press, 2000
- Kreuter, Presser & Tourangeau, *Social Desirability Bias in CATI, IVR, and Web Surveys*, POQ 72(5):847, 2008
- Pew Research Center, *Writing Survey Questions* — https://www.pewresearch.org/writing-survey-questions/
- Wuttke et al., *AI Conversational Interviewing*, 2024 — https://arxiv.org/abs/2410.01824 （under-probe）
- Barari et al., *AI-Assisted Conversational Interviewing*, 2025 — https://arxiv.org/abs/2504.13908
- Jacobsen, Cox, Griggio & van Berkel, *Chatbots for Data Collection: Four Theory-Based Interview Probes*, 2025 — https://arxiv.org/html/2503.08582v1
- Xiao, Zhou, Liao et al., *Tell Me About Yourself*, ACM TOCHI 27(3), 2020

**Readiness / adoption / prioritization**
- Jöhnk, Weißert & Wyrtki, *Ready or Not, AI Comes*, BISE 63(1):5, 2021 — https://aisel.aisnet.org/bise/vol63/iss1/2/ （五類就緒度）
- Babšek, Murko & Aristovnik, *Organisational AI Readiness for Public Administration*, IJEBA XIII(3):24, 2025
- Pinto, Abreu, Pérez Cota & Paiva, *A meta-analysis of TOE factors…*, Discover AI, 2025 — https://link.springer.com/article/10.1007/s44163-025-00747-2
- Ransbotham, Khodabandeh, Kiron et al., *Expanding AI's Impact With Organizational Learning*, MIT SMR–BCG, 2020 — https://sloanreview.mit.edu/projects/expanding-ais-impact-with-organizational-learning/ （21%→73%）
- McKinsey/QuantumBlack, *The state of AI: How organizations are rewiring to capture value*, 2025
- McKinsey/QuantumBlack, *From promise to impact*, 2026 （baseline metrics）
- Gartner, *AI Maturity Model and AI Roadmap Toolkit*, 2024
- Deloitte AI Institute, *State of AI in the Enterprise, 5th Edition*, 2022 （four-archetype）
- WEF, *Why data readiness is now a strategic imperative*, 2026

> 已剔除未核實的 magnitude（hypothetical 2-3x、Belli 84% enumeration、Wuttke input-mode 字數）；shadow-process practitioner blog 因 low-credibility + 引文不符不列入（方向性論點由 Contextual Inquiry / CIT 承載）。Gartner AI Opportunity Radar 的 Defend/Extend/Upend 軸描述有誤，勿引用。
