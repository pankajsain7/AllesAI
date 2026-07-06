

## 2. Consensus & Councils Improvements
- Refine consensus prompt for better synthesis quality
- Improve council debate flow (opening → critique → convergence)
- Add model alias/short-name support for cleaner council notes
- Better error handling and fallback logic
- Quality scoring and confidence display in results
- Expandable analysis details with delimiter-based answer split (done in last commit — verify)
- **LLM as judge**: Use a dedicated judge model to evaluate/rank model answers on accuracy, relevance, completeness
- **Orchestration layer**: Route sub-tasks to different models (e.g., one model researches, another critiques, a third synthesizes)
- **Multi-stage pipeline**: Chain models sequentially — first model drafts, second reviews/improves, third produces final
- **Configurable judge model**: Let user pick which model acts as judge/evaluator
- **Scoring rubric**: Display per-model scores (factual accuracy, clarity, citation use) in consensus results

## 3. Avatars
- 

## 4. Chat Interface Improvements
- Improve message bubble styling and spacing
- Better message grouping and threading
- Add timestamps or message ordering indicators
- Smooth scroll behavior on new messages
- Improve empty states and loading indicators

## 5. Margin, Padding & Gap Polish
- Audit spacing across all components (sidebar, header, columns, composer)
- Consistent gap/padding between header, alert banners, and content areas
- Improve column dividers and spacing in multi-model view
- Tighter mobile layout

## 6. Tavily Web Search Enhancements
- Improve web search toggle UX and visual feedback
- Better integration of web context into model prompts
- Show web search status per model response
- Handle web search errors gracefully
- Consider per-model web search toggle vs global toggle
