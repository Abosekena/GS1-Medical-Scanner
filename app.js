let supabaseClient=null, controls=null, reader=null, current=null, allRows=[];
const $=id=>document.getElementById(id);

function cfg(){return {url:localStorage.getItem("gs1_sb_url")||"",key:localStorage.getItem("gs1_sb_key")||""}}
function setStatus(msg,ok=false){$("connectionStatus").textContent=msg;$("connectionStatus").style.background=ok?"#ecfdf3":"#fff7ed"}
function openSettings(){let c=cfg();$("supabaseUrl").value=c.url;$("supabaseKey").value=c.key;$("settingsModal").classList.remove("hide")}
function closeSettings(){$("settingsModal").classList.add("hide")}
async function initSupabase(){
  const c=cfg();
  if(!c.url||!c.key){$("configNotice").classList.remove("hide");return false}
  try{
    supabaseClient=window.supabase.createClient(c.url,c.key);
    const {error}=await supabaseClient.from("scans").select("id",{count:"exact",head:true});
    if(error) throw error;
    $("configNotice").classList.add("hide");
    return true;
  }catch(e){$("configNotice").classList.remove("hide");console.error(e);return false}
}

function normalize(s){return String(s||"").replace(/\u001d/g,"\x1d").trim()}

function parseGS1(input){
  const s=normalize(input),o={};
  if(!s) throw Error("الكود فارغ");
  if(/^\(\d{2,4}\)/.test(s)){
    const re=/\((\d{2,4})\)/g;let m,parts=[];
    while((m=re.exec(s))!==null)parts.push({ai:m[1],start:m.index,end:re.lastIndex});
    for(let j=0;j<parts.length;j++){
      const p=parts[j],v=s.slice(p.end,j+1<parts.length?parts[j+1].start:s.length);
      o[p.ai]=v;
    }
  }else{
    let i=0;
    const fixed={"01":14,"17":6,"11":6,"13":6,"15":6};
    const variable=new Set(["10","21","30","37"]);
    while(i<s.length){
      if(s[i]==="\x1d"){i++;continue}
      const ai=s.slice(i,i+2);if(!/^\d{2}$/.test(ai))throw Error("AI غير معروف عند الموضع "+i);i+=2;
      if(fixed[ai]){const v=s.slice(i,i+fixed[ai]);if(v.length<fixed[ai])throw Error("بيانات ناقصة لـ AI "+ai);o[ai]=v;i+=fixed[ai]}
      else if(variable.has(ai)){let e=s.indexOf("\x1d",i);if(e<0)e=s.length;o[ai]=s.slice(i,e);i=e}
      else throw Error("AI غير مدعوم حاليًا: "+ai);
    }
  }
  const gtin=o["01"]||"";
  if(gtin && !/^\d{14}$/.test(gtin))throw Error("GTIN يجب أن يكون 14 رقمًا");
  let expiry="";
  if(o["17"]){if(!/^\d{6}$/.test(o["17"]))throw Error("AI 17 يجب أن يكون YYMMDD");expiry=`20${o["17"].slice(0,2)}-${o["17"].slice(2,4)}-${o["17"].slice(4,6)}`}
  return {gtin,lot:o["10"]||"",expiry,serial:o["21"]||"",raw:s};
}

async function findProduct(gtin){
  if(!gtin||!supabaseClient)return null;
  const {data,error}=await supabaseClient.from("products").select("*").eq("gtin",gtin).maybeSingle();
  if(error){console.warn(error);return null}
  return data;
}
async function showResult(x,type="GS1"){
  current=x;
  $("gtin").value=x.gtin;$("lot").value=x.lot;$("expiry").value=x.expiry;$("serial").value=x.serial;$("quantity").value=1;
  $("rawview").textContent=x.raw.replace(/\x1d/g,"[GS]");
  $("scanType").textContent=type;
  $("result").classList.remove("hide");
  const p=await findProduct(x.gtin);
  if(p){
    $("productHint").textContent=`${p.product_name||"منتج"} • GTIN ${p.gtin}${p.ref_number?" • REF "+p.ref_number:""}`;
    $("productHint").classList.remove("hide");
  }else{
    $("productHint").classList.add("hide");
  }
}

async function loadRows(){
  if(!supabaseClient)return;
  const {data,error}=await supabaseClient.from("scans").select("*").order("id",{ascending:false}).limit(1000);
  if(error){console.error(error);return}
  allRows=data||[];renderRows(allRows);renderSummary(allRows);
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function renderRows(a){
  $("count").textContent=a.length;$("qty").textContent=a.reduce((s,x)=>s+(Number(x.quantity)||0),0);
  const groups=new Set(a.map(x=>[x.gtin,x.lot,x.expiry,x.serial].join("|")));$("unique").textContent=groups.size;
  $("rows").innerHTML=a.map(x=>`<tr><td>${x.id}</td><td>${esc(x.gtin)}</td><td>${esc(x.lot)}</td><td>${esc(x.expiry)}</td><td>${esc(x.serial)}</td><td>${x.quantity}</td><td>${esc(x.symbology)}</td><td><button onclick="delRow(${x.id})">حذف</button></td></tr>`).join("");
}
function renderSummary(a){
  const m=new Map();
  for(const x of a){
    const k=[x.gtin||"",x.lot||"",x.expiry||"",x.serial||""].join("|");
    m.set(k,(m.get(k)||0)+(Number(x.quantity)||0));
  }
  $("summaryRows").innerHTML=[...m.entries()].map(([k,q])=>{const [g,l,e,s]=k.split("|");return `<tr><td>${esc(g)}</td><td>${esc(l)}</td><td>${esc(e)}</td><td>${esc(s)}</td><td>${q}</td></tr>`}).join("");
}
window.delRow=async id=>{
  if(!confirm("حذف القراءة؟"))return;
  const {error}=await supabaseClient.from("scans").delete().eq("id",id);
  if(error)alert("تعذر الحذف: "+error.message);else loadRows();
};

$("parse").onclick=async()=>{try{await showResult(parseGS1($("raw").value),"MANUAL/GS1")}catch(e){alert("تعذر التحليل: "+e.message)}};

$("save").onclick=async()=>{
  if(!current||!supabaseClient)return alert("اضبط الاتصال بقاعدة البيانات أولًا");
  const row={gtin:current.gtin,lot:current.lot||null,expiry:current.expiry||null,serial:current.serial||null,
    quantity:Math.max(1,Number($("quantity").value)||1),raw_gs1:current.raw,symbology:$("scanType").textContent,
    location:$("loc").value||null,reference:$("ref").value||null,user_name:$("user").value||null};
  const {error}=await supabaseClient.from("scans").insert(row);
  if(error){alert("تعذر الحفظ: "+error.message);return}
  $("result").classList.add("hide");current=null;await loadRows();
};

$("start").onclick=async()=>{
  if(!supabaseClient){openSettings();return}
  try{
    reader=new ZXing.BrowserMultiFormatReader();
    const devices=await ZXing.BrowserCodeReader.listVideoInputDevices();
    const device=devices.at(-1)?.deviceId;
    controls=await reader.decodeFromVideoDevice(device,$("video"),async result=>{
      if(!result)return;
      try{
        const text=result.getText(),type=result.getBarcodeFormat?.()?.toString?.()||"CAMERA";
        await showResult(parseGS1(text),type);
        controls?.stop();controls=null;$("stop").disabled=true;$("start").disabled=false;
        navigator.vibrate?.(100);
      }catch(e){$("raw").value=result.getText();$("scanType").textContent="CAMERA";$("configNotice").classList.add("hide")}
    });
    $("start").disabled=true;$("stop").disabled=false;
  }catch(e){alert("تعذر تشغيل الكاميرا: "+e.message)}
};
$("stop").onclick=()=>{controls?.stop();controls=null;$("stop").disabled=true;$("start").disabled=false};

$("settingsBtn").onclick=openSettings;$("setupBtn").onclick=openSettings;$("closeSettings").onclick=closeSettings;
$("saveSettings").onclick=async()=>{
  const url=$("supabaseUrl").value.trim().replace(/\/$/,""),key=$("supabaseKey").value.trim();
  if(!/^https:\/\/.+\.supabase\.co/.test(url)||!key){setStatus("تأكد من Project URL و Publishable Key");return}
  localStorage.setItem("gs1_sb_url",url);localStorage.setItem("gs1_sb_key",key);
  const ok=await initSupabase();
  if(ok){setStatus("تم الاتصال بنجاح بقاعدة البيانات ✓",true);await loadRows();setTimeout(closeSettings,500)}
  else setStatus("فشل الاتصال. راجع URL / Key وRLS/Data API");
};
$("clearSettings").onclick=()=>{localStorage.removeItem("gs1_sb_url");localStorage.removeItem("gs1_sb_key");supabaseClient=null;$("configNotice").classList.remove("hide");setStatus("تم مسح الإعدادات")};
$("refresh").onclick=loadRows;
$("clear").onclick=async()=>{if(!supabaseClient)return;if(confirm("مسح جميع القراءات من قاعدة البيانات؟")){const {error}=await supabaseClient.from("scans").delete().not("id","is",null);if(error)alert(error.message);else loadRows()}};
$("search").oninput=e=>{
  const q=e.target.value.trim().toLowerCase();
  renderRows(!q?allRows:allRows.filter(x=>[x.gtin,x.lot,x.expiry,x.serial,x.user_name,x.location].some(v=>String(v||"").toLowerCase().includes(q))));
};
$("export").onclick=()=>{
  if(!allRows.length)return alert("لا توجد بيانات للتصدير");
  const data=allRows.map(x=>({ID:x.id,Date:x.scanned_at,GTIN:x.gtin,LOT:x.lot,Expiry:x.expiry,Serial:x.serial,Quantity:x.quantity,RawGS1:x.raw_gs1,Symbology:x.symbology,Location:x.location,Reference:x.reference,User:x.user_name}));
  const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Scans");
  XLSX.writeFile(wb,`GS1_Scans_${new Date().toISOString().slice(0,10)}.xlsx`);
};

if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
(async()=>{if(await initSupabase())await loadRows()})();
