// GS1 Medical Scanner — corrected startup order
let supabaseClient=null, controls=null, reader=null, current=null, allRows=[], locations=[];
let torchOn=false, ocrBusy=false;
const $=id=>document.getElementById(id);
function cfg(){return {url:localStorage.getItem("gs1_sb_url")||"",key:localStorage.getItem("gs1_sb_key")||""}}

function ensureExtraUI(){
  const actions=$("start")?.parentElement;
  if(actions && !$("torch")){const b=document.createElement("button");b.id="torch";b.textContent="🔦 تشغيل الفلاش";actions.appendChild(b);}
  const result=$("result");
  if(result && !$("manualProductBox")){
    const box=document.createElement("div");box.id="manualProductBox";box.className="manual-product";box.style.cssText="margin-top:12px;padding:12px;border:1px solid #d0d5dd;border-radius:12px;background:#f8fafc";
    box.innerHTML=`<h3 style="margin:0 0 9px">إضافة المنتج إلى قاعدة المنتجات</h3><div class="grid"><label>GTIN / كود الصنف<input id="productGtin" placeholder="اكتب الكود أو استخدم الكاميرا"></label><label>اسم المنتج<input id="productName" placeholder="اسم المنتج"></label><label>رقم المرجع REF<input id="productRef" placeholder="REF"></label><label>الوحدة UOM<input id="productUom" value="EA" placeholder="EA"></label></div><label>الوصف<input id="productDesc" placeholder="وصف اختياري"></label><div class="actions"><button id="saveProduct" class="primary">💾 حفظ / تحديث المنتج</button><button id="ocr">📷 قراءة النص بالكاميرا</button></div><div id="ocrStatus" class="status">يمكنك تشغيل الكاميرا ثم قراءة النص المطبوع على المنتج.</div>`;
    const save=$("save");if(save)result.insertBefore(box,save);else result.appendChild(box);
  }
}

// Important: create the dynamic controls before binding their events.
ensureExtraUI();

function setStatus(msg,ok=false){if($("connectionStatus")){ $("connectionStatus").textContent=msg; $("connectionStatus").style.background=ok?"#ecfdf3":"#fff7ed"; }}
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
    await loadLocations();
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
    for(let j=0;j<parts.length;j++){const p=parts[j],v=s.slice(p.end,j+1<parts.length?parts[j+1].start:s.length);o[p.ai]=v;}
  }else{
    let i=0;const fixed={"01":14,"17":6,"11":6,"13":6,"15":6};const variable=new Set(["10","21","30","37"]);
    while(i<s.length){
      if(s[i]==="\x1d"){i++;continue}
      const ai=s.slice(i,i+2);if(!/^\d{2}$/.test(ai))throw Error("AI غير معروف عند الموضع "+i);i+=2;
      if(fixed[ai]){const v=s.slice(i,i+fixed[ai]);if(v.length<fixed[ai])throw Error("بيانات ناقصة لـ AI "+ai);o[ai]=v;i+=fixed[ai]}
      else if(variable.has(ai)){let e=s.indexOf("\x1d",i);if(e<0)e=s.length;o[ai]=s.slice(i,e);i=e}
      else throw Error("AI غير مدعوم حاليًا: "+ai);
    }
  }
  const gtin=o["01"]||"";if(gtin&&!/^\d{14}$/.test(gtin))throw Error("GTIN يجب أن يكون 14 رقمًا");
  let expiry="";if(o["17"]){if(!/^\d{6}$/.test(o["17"]))throw Error("AI 17 يجب أن يكون YYMMDD");expiry=`20${o["17"].slice(0,2)}-${o["17"].slice(2,4)}-${o["17"].slice(4,6)}`}
  return {gtin,lot:o["10"]||"",expiry,serial:o["21"]||"",raw:s};
}
async function findProduct(gtin){
  if(!gtin||!supabaseClient)return null;
  const {data,error}=await supabaseClient.from("products").select("*").eq("gtin",gtin).maybeSingle();
  if(error){console.warn(error);return null}return data;
}
async function loadLocations(){
  if(!supabaseClient||!$("locationId"))return;
  const {data,error}=await supabaseClient.from("locations").select("id,location_name,location_type,active").eq("active",true).order("id");
  if(error){console.warn("Locations error:",error);return}
  locations=data||[];
  for(const select of [$("locationId"),$("toLocationId")]){
    if(!select)continue;
    const previous=select.value;
    select.innerHTML='<option value="">اختر المخزن</option>';
    for(const location of locations){const option=document.createElement("option");option.value=location.id;option.textContent=location.location_name;select.appendChild(option)}
    select.value=previous;
  }
}
function updateMovementUI(){
  const type=$("movementType")?.value;
  const box=$("toLocationBox"),to=$("toLocationId"),quantity=$("quantity");
  if(box)box.classList.toggle("hide",type!=="TRANSFER");
  if(type!=="TRANSFER"&&to)to.value="";
  if(quantity)quantity.min=type==="ADJUSTMENT"?"-999999":"1";
}
function selectedLocationName(id){return locations.find(x=>String(x.id)===String(id))?.location_name||$("loc")?.value||null}
function setProductForm(p={}){
  if($("productGtin"))$("productGtin").value=p.gtin||"";
  if($("productName"))$("productName").value=p.product_name||"";
  if($("productRef"))$("productRef").value=p.ref_number||"";
  if($("productDesc"))$("productDesc").value=p.description||"";
  if($("productUom"))$("productUom").value=p.uom||"EA";
}
async function showResult(x,type="GS1"){
  current=x;
  $("gtin").value=x.gtin;$("lot").value=x.lot;$("expiry").value=x.expiry;$("serial").value=x.serial;$("quantity").value=1;
  $("rawview").textContent=x.raw.replace(/\x1d/g,"[GS]");$("scanType").textContent=type;$("result").classList.remove("hide");
  const p=await findProduct(x.gtin);
  if(p){
    $("productHint").textContent=`${p.product_name||"منتج"} • GTIN ${p.gtin}${p.ref_number?" • REF "+p.ref_number:""}`;$("productHint").classList.remove("hide");setProductForm(p);
  }else{
    $("productHint").textContent=x.gtin?`المنتج غير موجود في جدول products • GTIN ${x.gtin}`:"لم يتم استخراج GTIN من الكود";$("productHint").classList.remove("hide");setProductForm({gtin:x.gtin});
  }
}
async function loadRows(){
  if(!supabaseClient)return;const {data,error}=await supabaseClient.from("scans").select("*").order("id",{ascending:false}).limit(1000);
  if(error){console.error(error);return}allRows=data||[];renderRows(allRows);renderSummary(allRows);
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function formatDate(value){
  if(!value)return "";
  // Supabase returns ISO timestamps, but this also handles a space separator
  // and a short timezone offset if an older row uses either representation.
  const normalized=String(value).replace(" ","T").replace(/([+-]\d{2})$/,"$1:00");
  const date=new Date(normalized);
  return Number.isNaN(date.getTime())?esc(value):date.toLocaleString("ar-EG");
}
function ensureScanActionsHeader(){
  const header=$("rows")?.closest("table")?.querySelector("thead tr");
  if(header&&!header.querySelector('[data-column="actions"]')){
    const cell=document.createElement("th");
    cell.dataset.column="actions";
    cell.textContent="إجراء";
    header.appendChild(cell);
  }
}
function renderRows(a){
  $("count").textContent=a.length;$("qty").textContent=a.reduce((s,x)=>s+(Number(x.quantity)||0),0);const groups=new Set(a.map(x=>[x.gtin,x.lot,x.expiry,x.serial].join("|")));$("unique").textContent=groups.size;
  ensureScanActionsHeader();
  $("rows").innerHTML=a.map(x=>`<tr><td>${x.id}</td><td>${esc(x.gtin)}</td><td>${esc(x.lot)}</td><td>${esc(x.expiry)}</td><td>${esc(x.serial)}</td><td>${x.quantity}</td><td>${esc(x.symbology)}</td><td>${esc(x.reference)}</td><td>${formatDate(x.created_at||x.scanned_at)}</td><td><button onclick="delRow(${x.id})">حذف</button></td></tr>`).join("");
}
function renderSummary(a){
  const m=new Map();for(const x of a){const k=[x.gtin||"",x.lot||"",x.expiry||"",x.serial||""].join("|");m.set(k,(m.get(k)||0)+(Number(x.quantity)||0));}
  $("summaryRows").innerHTML=[...m.entries()].map(([k,q])=>{const [g,l,e,s]=k.split("|");return `<tr><td>${esc(g)}</td><td>${esc(l)}</td><td>${esc(e)}</td><td>${esc(s)}</td><td>${q}</td></tr>`}).join("");
}
async function loadStock(){
  if(!supabaseClient||!$("stockRows"))return;
  const {data,error}=await supabaseClient.from("stock").select("*").order("location_id");
  if(error){console.warn("Stock load error:",error);return}
  $("stockRows").innerHTML=(data||[]).map(x=>{
    const location=locations.find(l=>String(l.id)===String(x.location_id));
    return `<tr><td>${esc(x.gtin)}</td><td>${esc(x.lot)}</td><td>${esc(x.expiry)}</td><td>${esc(x.serial)}</td><td>${esc(location?.location_name||x.location_id)}</td><td>${esc(x.quantity)}</td></tr>`;
  }).join("");
}
window.delRow=async id=>{
  if($("movementType")&&$("locationId"))return alert("لا يمكن حذف سجل السكان من هنا بعد تفعيل المخزون، لأن ذلك لن يعكس حركة الرصيد. استخدم حركة تسوية أو مرتجع من نموذج الحركة.");
  if(!confirm("حذف القراءة؟"))return;
  const {error}=await supabaseClient.from("scans").delete().eq("id",id);
  if(error)alert("تعذر الحذف: "+error.message);else loadRows();
};
$("parse").onclick=async()=>{try{await showResult(parseGS1($("raw").value),"MANUAL/GS1")}catch(e){alert("تعذر التحليل: "+e.message)}};
async function saveProduct(){
  if(!supabaseClient)return alert("اضبط الاتصال بقاعدة البيانات أولًا");
  const gtin=$("productGtin").value.trim();const product_name=$("productName").value.trim();const ref_number=$("productRef").value.trim()||null;const description=$("productDesc").value.trim()||null;const uom=$("productUom").value.trim()||"EA";
  if(!gtin)return alert("اكتب كود GTIN / الصنف أولًا");if(!product_name)return alert("اكتب اسم المنتج أولًا");
  const payload={gtin,product_name,ref_number,description,uom,active:true};
  const existing=await findProduct(gtin);let error;
  if(existing){({error}=await supabaseClient.from("products").update(payload).eq("id",existing.id));}
  else {({error}=await supabaseClient.from("products").insert(payload));}
  if(error){alert("تعذر حفظ المنتج: "+error.message);return false}
  $("productHint").textContent=`تم حفظ المنتج ✓ • ${product_name} • GTIN ${gtin}`;$("productHint").classList.remove("hide");return true;
}
$("saveProduct").onclick=saveProduct;
$("save").onclick=async()=>{
  if(!current||!supabaseClient)return alert("اضبط الاتصال بقاعدة البيانات أولًا");
  const gtin=$("gtin").value.trim();if(!gtin)return alert("GTIN مطلوب");
  const inventoryMode=!!$("movementType")&&!!$("locationId");
  const type=$("movementType")?.value||"IN";
  const locationId=$("locationId")?.value;
  const toLocationId=$("toLocationId")?.value;
  const quantity=Number($("quantity").value);
  const reference=$("referenceNo")?.value.trim()||$("ref").value.trim()||null;
  if(!Number.isFinite(quantity)||quantity===0)return alert("الكمية يجب أن تكون رقمًا غير صفر");
  if(type!=="ADJUSTMENT"&&quantity<0)return alert("الكمية يجب أن تكون أكبر من صفر");
  if(inventoryMode){
    if(!locationId)return alert("اختر المخزن أولًا");
    if(type==="TRANSFER"&&!toLocationId)return alert("اختر المخزن المستلم أولًا");
    if(type==="TRANSFER"&&String(locationId)===String(toLocationId))return alert("المخزن المصدر والمستلم لا يمكن أن يكونا متطابقين");
    const product=await findProduct(gtin);
    if(!product)return alert("المنتج غير موجود. احفظ المنتج أولًا ثم سجّل حركة المخزون.");
    const movement={movement_type:type,product_id:product.id,location_id:Number(locationId),gtin,lot:$("lot").value.trim()||null,expiry:$("expiry").value.trim()||null,serial:$("serial").value.trim()||null,quantity,reference_no:reference,from_location_id:type==="TRANSFER"?Number(locationId):null,to_location_id:type==="TRANSFER"?Number(toLocationId):null};
    const {error:movementError}=await supabaseClient.from("stock_movements").insert(movement);
    if(movementError){alert("تعذر تسجيل حركة المخزون: "+movementError.message);return}
  }
  const row={gtin,lot:$("lot").value.trim()||null,expiry:$("expiry").value.trim()||null,serial:$("serial").value.trim()||null,quantity:Math.abs(quantity),raw_gs1:current.raw,symbology:$("scanType").textContent,location:inventoryMode?selectedLocationName(locationId):$("loc").value||null,reference,user_name:$("user").value||null};
  const {error}=await supabaseClient.from("scans").insert(row);if(error){alert("تمت حركة المخزون لكن تعذر تسجيل سجل السكان: "+error.message);return}
  $("result").classList.add("hide");current=null;await loadRows();if(inventoryMode)await loadStock();
};
async function setTorch(on){
  try{const track=$("video").srcObject?.getVideoTracks?.()[0];if(!track)throw Error("الكاميرا غير مشغلة");const cap=track.getCapabilities?.();if(!cap?.torch)throw Error("هذا الهاتف/المتصفح لا يدعم الفلاش من داخل صفحة الويب");await track.applyConstraints({advanced:[{torch:!!on}]});torchOn=!!on;$("torch").textContent=torchOn?"🔦 إيقاف الفلاش":"🔦 تشغيل الفلاش";}catch(e){alert(e.message)}
}
$("torch").onclick=()=>setTorch(!torchOn);
async function stopCamera(){try{await setTorch(false)}catch(_){}controls?.stop();controls=null;reader?.reset?.();$("stop").disabled=true;$("start").disabled=false;torchOn=false;$("torch").textContent="🔦 تشغيل الفلاش";}
$("start").onclick=async()=>{
  if(!supabaseClient){openSettings();return}
  try{const ZX=window.ZXingBrowser||window.ZXing;if(!ZX)throw Error("ZXingBrowser library لم يتم تحميلها. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.");reader=new ZX.BrowserMultiFormatReader();const devices=await ZX.BrowserCodeReader.listVideoInputDevices();const device=devices.at(-1)?.deviceId;
    controls=await reader.decodeFromVideoDevice(device,$("video"),async result=>{if(!result)return;try{const text=result.getText(),type=result.getBarcodeFormat?.()?.toString?.()||"CAMERA";await showResult(parseGS1(text),type);await stopCamera();navigator.vibrate?.(100);}catch(e){$("raw").value=result.getText();$("scanType").textContent="CAMERA";$("configNotice").classList.add("hide");}});
    $("start").disabled=true;$("stop").disabled=false;
  }catch(e){alert("تعذر تشغيل الكاميرا: "+e.message)}
};
$("stop").onclick=stopCamera;
async function startOCR(){
  if(ocrBusy)return;
  if(!window.Tesseract){
    $("ocrStatus").textContent="جاري تحميل محرك OCR لأول مرة…";
    await new Promise((resolve,reject)=>{const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";sc.onload=resolve;sc.onerror=()=>reject(new Error("تعذر تحميل محرك OCR"));document.head.appendChild(sc);});
  }
  if(!$("video").srcObject)return alert("شغّل الكاميرا أولًا من زر بدء السكان");
  ocrBusy=true;$("ocrStatus").textContent="جاري قراءة النص من الكاميرا…";
  try{const canvas=document.createElement("canvas"),video=$("video");canvas.width=video.videoWidth||1280;canvas.height=video.videoHeight||720;const ctx=canvas.getContext("2d");ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const {data}=await Tesseract.recognize(canvas,"eng",{logger:m=>{if(m.status==="recognizing text")$("ocrStatus").textContent=`OCR ${Math.round((m.progress||0)*100)}%`;}});
    const text=(data.text||"").trim();const candidates=text.match(/[A-Z0-9][A-Z0-9._\/-]{2,}/gi)||[];const preferred=candidates.find(v=>/\d{4,}/.test(v))||candidates[0]||text.replace(/\s+/g," ");
    $("productGtin").value=preferred;$("ocrStatus").textContent=text?`تمت القراءة: ${text}`:"لم يتم العثور على نص واضح";
  }catch(e){$("ocrStatus").textContent="فشل OCR";alert("تعذر قراءة النص: "+e.message)}finally{ocrBusy=false}
}
$("ocr").onclick=startOCR;
$("settingsBtn").onclick=openSettings;$("setupBtn").onclick=openSettings;$("closeSettings").onclick=closeSettings;
$("saveSettings").onclick=async()=>{const url=$("supabaseUrl").value.trim().replace(/\/$/,""),key=$("supabaseKey").value.trim();if(!/^https:\/\/.+\.supabase\.co/.test(url)||!key){setStatus("تأكد من Project URL و Publishable Key");return}localStorage.setItem("gs1_sb_url",url);localStorage.setItem("gs1_sb_key",key);const ok=await initSupabase();if(ok){setStatus("تم الاتصال بنجاح بقاعدة البيانات ✓",true);await loadRows();await loadStock();setTimeout(closeSettings,500)}else setStatus("فشل الاتصال. راجع URL / Key وRLS/Data API")};
$("clearSettings").onclick=()=>{localStorage.removeItem("gs1_sb_url");localStorage.removeItem("gs1_sb_key");supabaseClient=null;$("configNotice").classList.remove("hide");setStatus("تم مسح الإعدادات")};
$("refresh").onclick=loadRows;
$("refreshStock")?.addEventListener("click",loadStock);
$("movementType")?.addEventListener("change",updateMovementUI);
updateMovementUI();
$("clear")?.addEventListener("click",async()=>{if(!supabaseClient)return;if(confirm("مسح جميع القراءات من قاعدة البيانات؟")){const {error}=await supabaseClient.from("scans").delete().not("id","is",null);if(error)alert(error.message);else loadRows()}});
$("search").oninput=e=>{const q=e.target.value.trim().toLowerCase();renderRows(!q?allRows:allRows.filter(x=>[x.gtin,x.lot,x.expiry,x.serial,x.user_name,x.location].some(v=>String(v||"").toLowerCase().includes(q))))};
async function getProductsForExport(gtins){
  const products=new Map();
  if(!supabaseClient||!gtins.length)return products;
  // Query in batches so a large scan history still exports reliably.
  for(let i=0;i<gtins.length;i+=100){
    const {data,error}=await supabaseClient.from("products").select("gtin,product_name,description,ref_number,uom").in("gtin",gtins.slice(i,i+100));
    if(error){console.warn("Product export lookup failed:",error);continue}
    for(const product of data||[])products.set(product.gtin,product);
  }
  return products;
}
$("export").onclick=async()=>{
  if(!allRows.length)return alert("لا توجد بيانات للتصدير");
  try{
    const gtins=[...new Set(allRows.map(x=>x.gtin).filter(Boolean))];
    const products=await getProductsForExport(gtins);
    const data=allRows.map(x=>{
      const product=products.get(x.gtin)||{};
      return {
        ID:x.id,
        Date:x.scanned_at||x.created_at,
        GTIN:x.gtin,
        ProductCode:product.gtin||x.gtin,
        ProductName:product.product_name||"",
        Description:product.description||"",
        ProductReference:product.ref_number||"",
        UOM:product.uom||"",
        LOT:x.lot,
        Expiry:x.expiry,
        Serial:x.serial,
        Quantity:x.quantity,
        RawGS1:x.raw_gs1,
        Symbology:x.symbology,
        Location:x.location,
        ScanReference:x.reference,
        User:x.user_name
      };
    });
    const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Scans");
    XLSX.writeFile(wb,`GS1_Scans_${new Date().toISOString().slice(0,10)}.xlsx`);
  }catch(e){console.error(e);alert("تعذر إنشاء ملف Excel: "+e.message)}
};
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
(async()=>{if(await initSupabase()){await loadRows();await loadStock();}})();
