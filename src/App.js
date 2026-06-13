import { useState, useRef, useEffect, useCallback } from "react";

const systemPrompt = `あなたは韓国語学習を支援するAI教師です。
ユーザーが韓国語の文章や単語を入力したら、以下の形式でJSON（コードブロックなし）で回答してください。
{
  "meaning": "日本語訳（自然な日本語で）",
  "grammar": [{"point": "文法項目名","explanation": "わかりやすい説明","example": "例文（韓国語 → 日本語）"}],
  "vocabulary": [{"word": "単語（韓国語）","reading": "読み方（カタカナ）","meaning": "日本語の意味","partOfSpeech": "品詞"}],
  "tip": "学習のポイント（任意）"
}
必ずJSONのみを返してください。`;

const C = {
  bg:"#0d1018",surface:"#161923",card:"#1e2336",
  accent:"#5b8df7",accentSoft:"rgba(91,141,247,0.13)",
  gold:"#f7c948",goldSoft:"rgba(247,201,72,0.11)",
  green:"#4fd1a0",greenSoft:"rgba(79,209,160,0.11)",
  red:"#f76b6b",redSoft:"rgba(247,107,107,0.12)",
  text:"#e6eaf4",muted:"#7a84a0",border:"rgba(255,255,255,0.07)",
};

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const doSpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    const koVoice = voices.find(v => v.lang === "ko-KR" || v.lang.startsWith("ko"));
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 0.7;   // ゆっくり
    u.pitch = 1.0;
    u.volume = 1.0; // 最大音量
    if (koVoice) u.voice = koVoice;
    window.speechSynthesis.speak(u);
  };

  // voicesがまだ読み込まれていない場合は待つ
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    window.speechSynthesis.onvoiceschanged = () => { doSpeak(); };
  } else {
    doSpeak();
  }
}

const loadJSON = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } };
const saveJSON = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export default function App() {
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ttsOn, setTtsOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [history, setHistory] = useState(() => loadJSON("kr_history", []));
  const [vocab, setVocab] = useState(() => loadJSON("kr_vocab", []));
  const [vocabInput, setVocabInput] = useState({ kr:"", jp:"", reading:"" });
  const [quizMode, setQuizMode] = useState(false);
  const [quizCard, setQuizCard] = useState(null);
  const [quizFlipped, setQuizFlipped] = useState(false);
  const [toast, setToast] = useState("");
  const [speakingId, setSpeakingId] = useState(null);
  const recognitionRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const speakWithFeedback = (text, id) => {
    setSpeakingId(id);
    showToast("🔊 再生中...");
    speak(text);
    setTimeout(() => setSpeakingId(null), 2500);
  };

  const analyze = async (text) => {
    const t = (text || input).trim();
    if (!t || loading) return;
    setMessages(prev => [...prev, { role:"user", text:t }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:1000,
          system: systemPrompt,
          messages:[{ role:"user", content:t }],
        }),
      });
      const data = await res.json();
      const raw = data.content.map(c => c.text||"").join("");
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setMessages(prev => [...prev, { role:"assistant", data:parsed, query:t }]);
      const newH = [{ query:t, meaning:parsed.meaning, ts:Date.now() }, ...history].slice(0,50);
      setHistory(newH); saveJSON("kr_history", newH);
      if (ttsOn) speak(t);
    } catch {
      setMessages(prev => [...prev, { role:"error", text:"解析中にエラーが発生しました。" }]);
    }
    setLoading(false);
  };

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast("このブラウザは音声認識に対応していません"); return; }
    const r = new SR();
    r.lang="ko-KR"; r.interimResults=false;
    r.onstart=()=>setListening(true);
    r.onend=()=>setListening(false);
    r.onresult=(e)=>{ const t=e.results[0][0].transcript; setInput(t); showToast(`認識: ${t}`); };
    r.onerror=()=>{ setListening(false); showToast("音声認識に失敗しました"); };
    recognitionRef.current=r; r.start();
  }, []);

  const stopListening = () => { recognitionRef.current?.stop(); setListening(false); };

  const addVocab = () => {
    if (!vocabInput.kr.trim()) return;
    const newV = [{ ...vocabInput, id:Date.now() }, ...vocab];
    setVocab(newV); saveJSON("kr_vocab", newV);
    setVocabInput({ kr:"", jp:"", reading:"" });
    showToast("単語帳に追加しました！");
  };

  const removeVocab = (id) => {
    const newV = vocab.filter(v=>v.id!==id);
    setVocab(newV); saveJSON("kr_vocab", newV);
  };

  const addVocabFromResult = (word) => {
    if (vocab.find(v=>v.kr===word.word)) { showToast("すでに登録済みです"); return; }
    const newV = [{ kr:word.word, jp:word.meaning, reading:word.reading, id:Date.now() }, ...vocab];
    setVocab(newV); saveJSON("kr_vocab", newV);
    showToast(`「${word.word}」を単語帳に追加！`);
  };

  const startQuiz = () => {
    if (vocab.length===0) { showToast("単語帳が空です"); return; }
    setQuizCard(vocab[Math.floor(Math.random()*vocab.length)]);
    setQuizFlipped(false); setQuizMode(true);
  };

  const nextQuiz = () => {
    setQuizCard(vocab[Math.floor(Math.random()*vocab.length)]);
    setQuizFlipped(false);
  };

  const handleKey = (e) => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); analyze(); } };

  return (
    <div style={s.root}>
      {toast && <div style={s.toast}>{toast}</div>}

      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={{fontSize:22}}>🇰🇷</span>
          <div style={s.title}>한국어 학습</div>
        </div>
        <button
          style={{...s.iconBtn, background:ttsOn?C.accentSoft:"transparent", color:ttsOn?C.accent:C.muted}}
          onClick={()=>{ setTtsOn(v=>!v); showToast(ttsOn?"読み上げOFF":"読み上げON"); }}>
          {ttsOn?"🔊":"🔇"}
        </button>
      </div>

      <div style={s.tabs}>
        {[["chat","💬 学習"],["history","📋 履歴"],["vocab","📝 単語帳"]].map(([key,label])=>(
          <button key={key} style={{...s.tab,...(tab===key?s.tabActive:{})}} onClick={()=>setTab(key)}>{label}</button>
        ))}
      </div>

      {tab==="chat" && <>
        <div style={s.feed}>
          {messages.length===0 && (
            <div style={s.empty}>
              <div style={{fontSize:44,marginBottom:10}}>💬</div>
              <div style={s.emptyTitle}>韓国語を入力してください</div>
              <div style={s.emptyDesc}>単語・フレーズ・文章、なんでもOK！<br/>🎤ボタンで音声入力もできます</div>
              <div style={s.examples}>
                {["안녕하세요","사랑해요","오늘 날씨가 좋네요","저는 일본 사람이에요"].map(ex=>(
                  <button key={ex} style={s.exBtn} onClick={()=>analyze(ex)}>{ex}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg,i)=>{
            if (msg.role==="user") return (
              <div key={i} style={s.userWrap}>
                <button
                  style={{...s.ttsBtn, ...(speakingId===`u${i}`?s.ttsBtnActive:{})}}
                  onClick={()=>speakWithFeedback(msg.text,`u${i}`)}>
                  {speakingId===`u${i}`?"🔉":"🔊"}
                </button>
                <div style={s.userBubble}>{msg.text}</div>
              </div>
            );
            if (msg.role==="error") return <div key={i} style={s.errorBubble}>{msg.text}</div>;
            if (msg.role==="assistant"&&msg.data) {
              const d=msg.data;
              return (
                <div key={i} style={s.card}>
                  <div style={s.section}>
                    <div style={s.sLabel}>📖 意味</div>
                    <div style={s.meaningText}>{d.meaning}</div>
                  </div>
                  {d.vocabulary?.length>0 && (
                    <div style={s.section}>
                      <div style={s.sLabel}>📝 単語</div>
                      <div style={s.vocabGrid}>
                        {d.vocabulary.map((v,vi)=>(
                          <div key={vi} style={s.vocabCard}>
                            <div style={s.vocabTop}>
                              <div>
                                <div style={s.vocabWord}>{v.word}</div>
                                <div style={s.vocabReading}>{v.reading}</div>
                              </div>
                              <div style={{display:"flex",gap:3}}>
                                <button style={{...s.miniBtn,...(speakingId===`v${i}${vi}`?s.miniBtnActive:{})}} onClick={()=>speakWithFeedback(v.word,`v${i}${vi}`)}>
                                  {speakingId===`v${i}${vi}`?"🔉":"🔊"}
                                </button>
                                <button style={{...s.miniBtn,fontSize:14}} onClick={()=>addVocabFromResult(v)}>＋</button>
                              </div>
                            </div>
                            <div style={s.vocabMeaning}>{v.meaning}</div>
                            <div style={s.vocabPos}>{v.partOfSpeech}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {d.grammar?.length>0 && (
                    <div style={s.section}>
                      <div style={s.sLabel}>📐 文法</div>
                      {d.grammar.map((g,gi)=>(
                        <div key={gi} style={s.grammarItem}>
                          <div style={s.grammarPoint}>{g.point}</div>
                          <div style={s.grammarExpl}>{g.explanation}</div>
                          {g.example&&<div style={s.grammarEx}>例: {g.example}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {d.tip&&<div style={s.tip}><span style={{marginRight:6}}>💡</span>{d.tip}</div>}
                </div>
              );
            }
            return null;
          })}
          {loading && (
            <div style={s.loadingWrap}>
              {[0,1,2].map(n=><div key={n} style={{...s.dot,animationDelay:`${n*0.2}s`}}/>)}
              <span style={{color:C.muted,fontSize:13,marginLeft:8}}>解析中...</span>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>
        <div style={s.inputArea}>
          <div style={s.inputRow}>
            <button
              style={{...s.micBtn,background:listening?C.red:C.accentSoft,color:listening?"#fff":C.accent}}
              onClick={listening?stopListening:startListening}>
              {listening?"⏹":"🎤"}
            </button>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="韓国語を入力... (Enterで送信)" style={s.textarea} rows={1}/>
            <button onClick={()=>analyze()} disabled={!input.trim()||loading}
              style={{...s.sendBtn,opacity:!input.trim()||loading?0.4:1}}>解析</button>
          </div>
          {listening&&<div style={s.listeningBadge}>🎤 韓国語を話してください...</div>}
        </div>
      </>}

      {tab==="history" && (
        <div style={s.feed}>
          {history.length===0 ? (
            <div style={s.empty}>
              <div style={{fontSize:44,marginBottom:10}}>📋</div>
              <div style={s.emptyTitle}>履歴がありません</div>
              <div style={s.emptyDesc}>学習した内容がここに表示されます</div>
            </div>
          ) : (
            <>
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button style={s.clearBtn} onClick={()=>{setHistory([]);saveJSON("kr_history",[]);showToast("履歴を削除しました");}}>
                  🗑 全削除
                </button>
              </div>
              {history.map((h,i)=>(
                <div key={i} style={s.historyItem}>
                  <div style={s.historyKr}>
                    {h.query}
                    <button style={{...s.miniBtn,...(speakingId===`h${i}`?s.miniBtnActive:{})}} onClick={()=>speakWithFeedback(h.query,`h${i}`)}>
                      {speakingId===`h${i}`?"🔉":"🔊"}
                    </button>
                  </div>
                  <div style={s.historyJp}>{h.meaning}</div>
                  <div style={s.historyTs}>{new Date(h.ts).toLocaleString("ja-JP")}</div>
                  <button style={s.reanalyzeBtn} onClick={()=>{setTab("chat");setTimeout(()=>analyze(h.query),100);}}>
                    もう一度解析
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab==="vocab" && (
        <div style={s.feed}>
          <div style={s.vocabForm}>
            <div style={s.sLabel}>➕ 単語を手動で追加</div>
            <input style={s.formInput} placeholder="韓国語（例: 안녕）" value={vocabInput.kr}
              onChange={e=>setVocabInput(v=>({...v,kr:e.target.value}))}/>
            <input style={s.formInput} placeholder="読み方（例: アンニョン）" value={vocabInput.reading}
              onChange={e=>setVocabInput(v=>({...v,reading:e.target.value}))}/>
            <input style={s.formInput} placeholder="日本語の意味（例: こんにちは）" value={vocabInput.jp}
              onChange={e=>setVocabInput(v=>({...v,jp:e.target.value}))}/>
            <button style={s.addBtn} onClick={addVocab}>追加する</button>
          </div>

          {vocab.length>0 && (
            <button style={s.quizStartBtn} onClick={startQuiz}>🃏 単語クイズを始める（{vocab.length}語）</button>
          )}

          {quizMode&&quizCard&&(
            <div style={s.quizModal}>
              <div style={s.quizCard} onClick={()=>setQuizFlipped(v=>!v)}>
                {!quizFlipped?(
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>日本語は？（タップで答え）</div>
                    <div style={{fontSize:32,fontWeight:700,color:C.gold}}>{quizCard.kr}</div>
                    <button style={{...s.miniBtn,marginTop:10}} onClick={e=>{e.stopPropagation();speak(quizCard.kr);}}>🔊 発音</button>
                  </div>
                ):(
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:26,fontWeight:700,color:C.green,marginBottom:6}}>{quizCard.jp}</div>
                    <div style={{fontSize:14,color:C.muted}}>{quizCard.reading}</div>
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:10,marginTop:12,justifyContent:"center"}}>
                <button style={{...s.quizBtn,background:C.greenSoft,color:C.green}} onClick={nextQuiz}>次の問題 ➜</button>
                <button style={{...s.quizBtn,background:C.redSoft,color:C.red}} onClick={()=>setQuizMode(false)}>終了</button>
              </div>
            </div>
          )}

          {vocab.length===0?(
            <div style={s.empty}>
              <div style={{fontSize:44,marginBottom:10}}>📝</div>
              <div style={s.emptyTitle}>単語帳が空です</div>
              <div style={s.emptyDesc}>解析結果の「＋」ボタンや<br/>上のフォームから追加できます</div>
            </div>
          ):(
            vocab.map(v=>(
              <div key={v.id} style={s.vocabListItem}>
                <div style={s.vocabListKr}>
                  {v.kr}
                  <button style={{...s.miniBtn,...(speakingId===`vl${v.id}`?s.miniBtnActive:{})}} onClick={()=>speakWithFeedback(v.kr,`vl${v.id}`)}>
                    {speakingId===`vl${v.id}`?"🔉":"🔊"}
                  </button>
                </div>
                <div style={{flex:1}}>
                  <div style={s.vocabListReading}>{v.reading}</div>
                  <div style={s.vocabListJp}>{v.jp}</div>
                </div>
                <button style={s.removeBtn} onClick={()=>removeVocab(v.id)}>✕</button>
              </div>
            ))
          )}
        </div>
      )}

      <style>{`
        @keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
        input,textarea{color:#e6eaf4 !important}
        input::placeholder,textarea::placeholder{color:#7a84a0}
      `}</style>
    </div>
  );
}

const s = {
  root:{display:"flex",flexDirection:"column",height:"100vh",background:C.bg,fontFamily:"'Segoe UI','Noto Sans JP',sans-serif",color:C.text,overflow:"hidden"},
  header:{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0},
  headerLeft:{display:"flex",alignItems:"center",gap:10},
  title:{fontSize:16,fontWeight:700},
  iconBtn:{border:"none",borderRadius:8,padding:"6px 10px",fontSize:18,cursor:"pointer",transition:"all 0.2s"},
  tabs:{display:"flex",background:C.surface,borderBottom:`1px solid ${C.border}`,flexShrink:0},
  tab:{flex:1,padding:"10px 4px",background:"transparent",border:"none",color:C.muted,fontSize:13,fontWeight:600,cursor:"pointer",borderBottom:"2px solid transparent",fontFamily:"inherit"},
  tabActive:{color:C.accent,borderBottomColor:C.accent},
  feed:{flex:1,overflowY:"auto",padding:"14px 14px 20px",display:"flex",flexDirection:"column",gap:14},
  empty:{textAlign:"center",marginTop:40,color:C.muted,animation:"fadeIn 0.4s ease"},
  emptyTitle:{fontSize:16,fontWeight:600,color:C.text,marginBottom:6},
  emptyDesc:{fontSize:13,lineHeight:1.7,marginBottom:18},
  examples:{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"},
  exBtn:{background:C.accentSoft,border:`1px solid ${C.accent}44`,borderRadius:20,padding:"6px 14px",color:C.accent,fontSize:13,cursor:"pointer",fontFamily:"inherit"},
  userWrap:{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6},
  userBubble:{background:C.accent,color:"#fff",borderRadius:"18px 18px 4px 18px",padding:"10px 15px",fontSize:15,maxWidth:"78%",lineHeight:1.5,fontWeight:500},
  ttsBtn:{background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,fontSize:18,cursor:"pointer",padding:"4px 8px",opacity:0.8,transition:"all 0.15s"},
  ttsBtnActive:{background:C.accentSoft,borderColor:C.accent,opacity:1,transform:"scale(1.15)"},
  card:{background:C.card,borderRadius:14,padding:"16px",border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:14,animation:"fadeIn 0.3s ease"},
  section:{display:"flex",flexDirection:"column",gap:8},
  sLabel:{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"0.06em",textTransform:"uppercase"},
  meaningText:{fontSize:16,fontWeight:600,color:C.text,lineHeight:1.6,background:C.accentSoft,borderLeft:`3px solid ${C.accent}`,padding:"10px 13px",borderRadius:"0 10px 10px 0"},
  vocabGrid:{display:"flex",flexWrap:"wrap",gap:8},
  vocabCard:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",flex:"1 1 130px",maxWidth:180},
  vocabTop:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4},
  vocabWord:{fontSize:17,fontWeight:700,color:C.gold},
  vocabReading:{fontSize:11,color:C.muted},
  vocabMeaning:{fontSize:13,color:C.text,fontWeight:500,marginBottom:4},
  vocabPos:{display:"inline-block",fontSize:10,color:C.green,background:C.greenSoft,borderRadius:5,padding:"2px 6px"},
  miniBtn:{background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 8px",fontSize:13,cursor:"pointer",color:C.muted,fontFamily:"inherit",transition:"all 0.15s"},
  miniBtnActive:{background:C.accentSoft,borderColor:C.accent,color:C.accent,transform:"scale(1.1)"},
  grammarItem:{background:C.surface,borderRadius:10,padding:"10px 13px",borderLeft:`3px solid ${C.gold}`},
  grammarPoint:{fontSize:13,fontWeight:700,color:C.gold,marginBottom:3},
  grammarExpl:{fontSize:13,color:C.text,lineHeight:1.6,marginBottom:4},
  grammarEx:{fontSize:12,color:C.muted,background:C.goldSoft,borderRadius:5,padding:"3px 8px",display:"inline-block"},
  tip:{fontSize:12,color:C.muted,background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 12px",lineHeight:1.6,borderLeft:`3px solid ${C.green}`},
  errorBubble:{background:C.redSoft,border:`1px solid ${C.red}44`,color:"#ff8080",borderRadius:10,padding:"10px 14px",fontSize:13},
  loadingWrap:{display:"flex",alignItems:"center",gap:4},
  dot:{width:8,height:8,borderRadius:"50%",background:C.accent,animation:"bounce 1.2s infinite"},
  inputArea:{borderTop:`1px solid ${C.border}`,background:C.surface,padding:"10px 14px",flexShrink:0},
  inputRow:{display:"flex",gap:8,alignItems:"flex-end"},
  micBtn:{border:"none",borderRadius:10,padding:"10px",fontSize:18,cursor:"pointer",flexShrink:0,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center"},
  textarea:{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 13px",fontSize:14,fontFamily:"inherit",resize:"none",outline:"none",lineHeight:1.5,minHeight:42,maxHeight:100,overflowY:"auto"},
  sendBtn:{background:C.accent,color:"#fff",border:"none",borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:700,fontFamily:"inherit",height:42,flexShrink:0,cursor:"pointer"},
  listeningBadge:{marginTop:6,fontSize:12,color:C.red,textAlign:"center",animation:"fadeIn 0.3s ease"},
  historyItem:{background:C.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.border}`},
  historyKr:{fontSize:17,fontWeight:700,color:C.gold,marginBottom:4,display:"flex",alignItems:"center",gap:8},
  historyJp:{fontSize:13,color:C.text,marginBottom:4},
  historyTs:{fontSize:11,color:C.muted,marginBottom:8},
  reanalyzeBtn:{background:C.accentSoft,border:`1px solid ${C.accent}44`,color:C.accent,borderRadius:8,padding:"4px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"},
  clearBtn:{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"4px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit",marginBottom:4},
  vocabForm:{background:C.card,borderRadius:12,padding:"14px",border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:8},
  formInput:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 12px",fontSize:14,fontFamily:"inherit",outline:"none"},
  addBtn:{background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"9px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"},
  quizStartBtn:{background:C.goldSoft,border:`1px solid ${C.gold}44`,color:C.gold,borderRadius:10,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textAlign:"center"},
  quizModal:{background:C.card,borderRadius:14,padding:"20px",border:`1px solid ${C.border}`,animation:"fadeIn 0.3s ease"},
  quizCard:{background:C.surface,borderRadius:12,padding:"30px 20px",cursor:"pointer",textAlign:"center",minHeight:120,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${C.border}`},
  quizBtn:{border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"},
  vocabListItem:{background:C.card,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10},
  vocabListKr:{fontSize:17,fontWeight:700,color:C.gold,display:"flex",alignItems:"center",gap:6,minWidth:90},
  vocabListReading:{fontSize:11,color:C.muted},
  vocabListJp:{fontSize:13,color:C.text},
  removeBtn:{background:"transparent",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:"2px 6px",marginLeft:"auto",flexShrink:0},
  toast:{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",background:"rgba(30,35,54,0.97)",border:`1px solid ${C.border}`,color:C.text,borderRadius:10,padding:"8px 18px",fontSize:13,zIndex:999,animation:"fadeIn 0.2s ease",whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,0.4)"},
};
