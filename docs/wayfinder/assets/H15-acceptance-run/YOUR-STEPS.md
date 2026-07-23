# Your steps — the human half of the acceptance run

Everything else (health checks, the 8 headless bench runs, collecting your chat files,
scoring) is done for you by the main session. **Your only job: paste 8 prompts into the
app, one per new chat, and let each finish.**

## Once, before starting

1. Rebuild + launch the app from the current tree the way you normally do
   (the fixes are in source — an old build would test the old prompt).
2. Open the model picker and select **Anthropic: Claude Sonnet 5** (OpenRouter).
3. Tell the main Claude session "start" — it runs the EPO health check and the bench
   half in parallel while you do the below.

## Per task — 8 times, in this order

New chat → check the model still says Sonnet 5 → paste the prompt → while it runs:
if it shows a question card, pick the **first/default option**; if it asks to run a
tool, click **Allow in this Session**. Then **wait until it fully stops** — no time
limit, even if it grinds for 30+ minutes. Then next task.

- [ ] **S1**
```
Find prior art for magnetocaloric refrigeration using layered La-Fe-Si alloys. Give me the 5 closest patents with numbers and one-line relevance notes.
```
- [ ] **S2**
```
Is there any patent on a "piezoresistive smart bandage" — a hydrogel wound dressing that senses strain? Find the 3 closest patents.
```
- [ ] **S3**
```
For EP3564557A1: what does claim 1 cover, is the patent still in force, and which prior-art references have been cited as novelty-destroying (X) against its family?
```
- [ ] **S4**
```
Find recent US patent applications from DeepMind about protein structure prediction, and show the continuity chain (parent/child applications) of the most relevant one.
```
- [ ] **R1**
```
Get me the full text of the claims of US10958080B2.
```
- [ ] **R2**
```
Pull the claims and current legal status of EP9876543A1.
```
- [ ] **R3**
```
Summarize the detailed description of EP2771468A1 in about 10 bullet points, covering the main embodiments.
```
- [ ] **R4**
```
How many EP patent applications were filed between 2020 and 2024 for mRNA lipid nanoparticle vaccines, who are the top assignees, and which 5 patents are the most cited?
```

## When done

Tell the main session "done" + anything odd (a chat you redid, a crash, a suspected
backend outage, a chat where the model picker had reverted). That's it — do not export
or copy any files.
