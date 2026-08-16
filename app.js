/* =========================================================
   GS1 MEDICAL SCANNER
   Inventory Version
   ========================================================= */


let supabaseClient = null;

let controls = null;

let reader = null;

let current = null;

let allMovements = [];

let locations = [];



/* =========================================================
   Helpers
   ========================================================= */

const $ = id => document.getElementById(id);



function cfg() {

  return {

    url:
      localStorage.getItem("gs1_sb_url") || "",

    key:
      localStorage.getItem("gs1_sb_key") || ""

  };

}



function setStatus(msg, ok = false) {

  $("connectionStatus").textContent = msg;

  $("connectionStatus").style.background =
    ok ? "#ecfdf3" : "#fff7ed";

}



function openSettings() {

  const c = cfg();

  $("supabaseUrl").value = c.url;

  $("supabaseKey").value = c.key;

  $("settingsModal").classList.remove("hide");

}



function closeSettings() {

  $("settingsModal").classList.add("hide");

}



function esc(v) {

  return String(v ?? "")
    .replace(
      /[&<>"']/g,
      c =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[c])
    );

}



/* =========================================================
   Supabase
   ========================================================= */

async function initSupabase() {

  const c = cfg();

  if (!c.url || !c.key) {

    $("configNotice").classList.remove("hide");

    return false;

  }


  try {

    supabaseClient =
      window.supabase.createClient(
        c.url,
        c.key
      );


    const { error } =
      await supabaseClient
        .from("products")
        .select("id")
        .limit(1);


    if (error) throw error;


    $("configNotice").classList.add("hide");

    await loadLocations();

    return true;


  } catch (e) {

    console.error(e);

    $("configNotice").classList.remove("hide");

    return false;

  }

}



/* =========================================================
   GS1 Parser
   ========================================================= */

function normalize(s) {

  return String(s || "")
    .replace(/\u001d/g, "\x1d")
    .trim();

}



function parseGS1(input) {

  const s = normalize(input);

  const o = {};


  if (!s) {

    throw Error("الكود فارغ");

  }



  /* ===============================
     Human readable GS1
     مثل:
     (01)123...(17)...
     =============================== */

  if (/^\(\d{2,4}\)/.test(s)) {

    const re = /\((\d{2,4})\)/g;

    let m;

    let parts = [];


    while ((m = re.exec(s)) !== null) {

      parts.push({

        ai: m[1],

        start: m.index,

        end: re.lastIndex

      });

    }


    for (
      let j = 0;
      j < parts.length;
      j++
    ) {

      const p = parts[j];

      const v =
        s.slice(
          p.end,
          j + 1 < parts.length
            ? parts[j + 1].start
            : s.length
        );

      o[p.ai] = v;

    }

  }


  /* ===============================
     Raw GS1
     =============================== */

  else {

    let i = 0;


    const fixed = {

      "01": 14,

      "17": 6,

      "11": 6,

      "13": 6,

      "15": 6

    };


    const variable =
      new Set([
        "10",
        "21",
        "30",
        "37"
      ]);


    while (i < s.length) {

      if (s[i] === "\x1d") {

        i++;

        continue;

      }


      const ai =
        s.slice(i, i + 2);


      if (!/^\d{2}$/.test(ai)) {

        throw Error(
          "AI غير معروف عند الموضع " + i
        );

      }


      i += 2;


      if (fixed[ai]) {

        const v =
          s.slice(
            i,
            i + fixed[ai]
          );


        if (
          v.length <
          fixed[ai]
        ) {

          throw Error(
            "بيانات ناقصة لـ AI " + ai
          );

        }


        o[ai] = v;

        i += fixed[ai];

      }


      else if (variable.has(ai)) {

        let e =
          s.indexOf(
            "\x1d",
            i
          );


        if (e < 0)
          e = s.length;


        o[ai] =
          s.slice(i, e);


        i = e;

      }


      else {

        throw Error(
          "AI غير مدعوم حاليًا: " + ai
        );

      }

    }

  }



  const gtin =
    o["01"] || "";


  if (
    gtin &&
    !/^\d{14}$/.test(gtin)
  ) {

    throw Error(
      "GTIN يجب أن يكون 14 رقمًا"
    );

  }



  let expiry = "";


  if (o["17"]) {

    if (
      !/^\d{6}$/.test(o["17"])
    ) {

      throw Error(
        "AI 17 يجب أن يكون YYMMDD"
      );

    }


    expiry =
      `20${o["17"].slice(0, 2)}-` +
      `${o["17"].slice(2, 4)}-` +
      `${o["17"].slice(4, 6)}`;

  }



  return {

    gtin,

    lot:
      o["10"] || "",

    expiry,

    serial:
      o["21"] || "",

    raw: s

  };

}



/* =========================================================
   Products
   ========================================================= */

async function findProduct(gtin) {

  if (
    !gtin ||
    !supabaseClient
  )
    return null;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("products")
      .select("*")
      .eq("gtin", gtin)
      .maybeSingle();


  if (error) {

    console.warn(error);

    return null;

  }


  return data;

}



/* =========================================================
   Locations
   ========================================================= */

async function loadLocations() {

  if (!supabaseClient)
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("locations")
      .select(
        "id,location_name,location_type,active"
      )
      .eq("active", true)
      .order("id");


  if (error) {

    console.error(
      "Locations error:",
      error
    );

    return;

  }


  locations = data || [];


  populateLocationSelects();

}



function populateLocationSelects() {

  const main =
    $("locationId");

  const to =
    $("toLocationId");


  if (!main || !to)
    return;


  main.innerHTML =
    `<option value="">
       اختر المخزن
     </option>`;


  to.innerHTML =
    `<option value="">
       اختر المخزن المستلم
     </option>`;


  locations.forEach(location => {

    const option1 =
      document.createElement("option");

    option1.value =
      location.id;

    option1.textContent =
      location.location_name;

    main.appendChild(option1);



    const option2 =
      document.createElement("option");

    option2.value =
      location.id;

    option2.textContent =
      location.location_name;

    to.appendChild(option2);

  });

}



/* =========================================================
   Show Scan Result
   ========================================================= */

async function showResult(
  x,
  type = "GS1"
) {

  current = x;


  $("gtin").value =
    x.gtin;

  $("lot").value =
    x.lot;

  $("expiry").value =
    x.expiry;

  $("serial").value =
    x.serial;


  $("quantity").value = 1;


  $("rawview").textContent =
    x.raw.replace(
      /\x1d/g,
      "[GS]"
    );


  $("scanType").textContent =
    type;


  $("result").classList.remove(
    "hide"
  );



  /* البحث عن المنتج */

  const p =
    await findProduct(
      x.gtin
    );


  if (p) {

    $("productHint").textContent =
      `${p.product_name || "منتج"} • ` +
      `GTIN ${p.gtin}` +
      (
        p.ref_number
          ? ` • REF ${p.ref_number}`
          : ""
      );


    $("productHint")
      .classList
      .remove("hide");

  }


  else {

    $("productHint")
      .classList
      .add("hide");

  }

}



/* =========================================================
   Movement Labels
   ========================================================= */

function movementLabel(type) {

  const labels = {

    IN:
      "دخول",

    OUT:
      "صرف",

    RETURN_IN:
      "مرتجع دخول",

    RETURN_OUT:
      "مرتجع خروج",

    TRANSFER:
      "تحويل",

    ADJUSTMENT:
      "تسوية"

  };


  return labels[type] || type;

}



/* =========================================================
   Transfer UI
   ========================================================= */

function updateMovementUI() {

  const type =
    $("movementType").value;


  if (type === "TRANSFER") {

    $("toLocationBox")
      .classList
      .remove("hide");

  }

  else {

    $("toLocationBox")
      .classList
      .add("hide");

    $("toLocationId").value = "";

  }



  /* Adjustment يسمح بقيمة سالبة
     لكن الواجهة تبدأ بموجب */

  if (type === "ADJUSTMENT") {

    $("quantity").min = "-999999";

  }

  else {

    $("quantity").min = "1";

  }

}



/* =========================================================
   Save Movement
   ========================================================= */

async function saveMovement() {

  if (
    !current ||
    !supabaseClient
  ) {

    alert(
      "اضبط الاتصال بقاعدة البيانات أولًا"
    );

    return;

  }



  const movementType =
    $("movementType").value;


  const locationId =
    $("locationId").value;


  const toLocationId =
    $("toLocationId").value;


  let quantity =
    Number(
      $("quantity").value
    );


  const referenceNo =
    $("referenceNo").value.trim();


  const notes =
    $("movementNotes").value.trim();



  /* ===============================
     Validation
     =============================== */

  if (!locationId) {

    alert(
      "من فضلك اختر المخزن"
    );

    return;

  }



  if (
    movementType === "TRANSFER" &&
    !toLocationId
  ) {

    alert(
      "من فضلك اختر المخزن المستلم"
    );

    return;

  }



  if (
    movementType === "TRANSFER" &&
    String(locationId) ===
    String(toLocationId)
  ) {

    alert(
      "مخزن المصدر والمستلم لا يمكن أن يكونا نفس المخزن"
    );

    return;

  }



  if (
    movementType !== "ADJUSTMENT" &&
    quantity <= 0
  ) {

    alert(
      "الكمية يجب أن تكون أكبر من صفر"
    );

    return;

  }



  if (
    movementType === "ADJUSTMENT" &&
    quantity === 0
  ) {

    alert(
      "قيمة التسوية لا يمكن أن تكون صفر"
    );

    return;

  }



  /* ===============================
     البحث عن المنتج
     =============================== */

  const product =
    await findProduct(
      current.gtin
    );


  if (!product) {

    alert(
      "المنتج غير موجود في جدول products.\n" +
      "GTIN: " +
      current.gtin
    );

    return;

  }



  /* ===============================
     إنشاء حركة المخزون
     =============================== */

  const row = {

    movement_type:
      movementType,

    product_id:
      product.id,

    location_id:
      Number(locationId),

    gtin:
      current.gtin || null,

    lot:
      current.lot || null,

    expiry:
      current.expiry || null,

    serial:
      current.serial || null,

    quantity:
      quantity,

    reference_no:
      referenceNo || null,

    from_location_id:
      movementType === "TRANSFER"
        ? Number(locationId)
        : null,

    to_location_id:
      movementType === "TRANSFER"
        ? Number(toLocationId)
        : null

  };



  /* ===============================
     Insert
     =============================== */

  const {
    error
  } =
    await supabaseClient
      .from("stock_movements")
      .insert(row);


  if (error) {

    console.error(error);

    alert(
      "تعذر تسجيل الحركة:\n\n" +
      error.message
    );

    return;

  }



  /* ===============================
     تسجيل Scan أيضًا
     =============================== */

  const scanRow = {

    gtin:
      current.gtin,

    lot:
      current.lot || null,

    expiry:
      current.expiry || null,

    serial:
      current.serial || null,

    quantity:
      Math.abs(quantity),

    raw_gs1:
      current.raw,

    symbology:
      $("scanType").textContent,

    location:
      $("loc").value || null,

    reference:
      referenceNo || null,

    user_name:
      $("user").value || null

  };


  const scanResult =
    await supabaseClient
      .from("scans")
      .insert(scanRow);


  if (scanResult.error) {

    console.warn(
      "Movement saved but scan log failed:",
      scanResult.error
    );

  }



  alert(
    "تم تسجيل حركة المخزون بنجاح ✓\n\n" +
    "الحركة: " +
    movementLabel(movementType) +
    "\nالكمية: " +
    quantity
  );


  $("result")
    .classList
    .add("hide");


  current = null;


  await loadMovements();

  await loadStock();

}



/* =========================================================
   Load Movements
   ========================================================= */

async function loadMovements() {

  if (!supabaseClient)
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("stock_movements")
      .select("*")
      .order(
        "id",
        {
          ascending: false
        }
      )
      .limit(1000);


  if (error) {

    console.error(
      "Movements error:",
      error
    );

    return;

  }


  allMovements =
    data || [];


  renderMovements(
    allMovements
  );

}



/* =========================================================
   Render Movements
   ========================================================= */

function renderMovements(data) {

  $("count").textContent =
    data.length;


  $("qty").textContent =
    data.reduce(
      (sum, x) =>
        sum +
        Math.abs(
          Number(x.quantity) || 0
        ),
      0
    );


  const groups =
    new Set(
      data.map(
        x =>
          [
            x.product_id,
            x.gtin,
            x.lot,
            x.serial
          ].join("|")
      )
    );


  $("unique").textContent =
    groups.size;



  $("rows").innerHTML =
    data
      .map(
        x => `

<tr>

<td>
${esc(x.id)}
</td>

<td>
${esc(x.gtin)}
</td>

<td>
${esc(x.lot)}
</td>

<td>
${esc(x.expiry)}
</td>

<td>
${esc(x.serial)}
</td>

<td>
${esc(x.quantity)}
</td>

<td>
${esc(
  movementLabel(
    x.movement_type
  )
)}
</td>

<td>
${esc(x.reference_no)}
</td>

<td>
${x.created_at
  ? new Date(
      x.created_at
    ).toLocaleString("ar-EG")
  : ""}
</td>

</tr>

`
      )
      .join("");

}



/* =========================================================
   Load Current Stock
   ========================================================= */

async function loadStock() {

  if (!supabaseClient)
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("stock")
      .select(`
        product_id,
        gtin,
        lot,
        expiry,
        serial,
        location_id,
        quantity
      `)
      .order(
        "location_id"
      );


  if (error) {

    console.error(
      "Stock error:",
      error
    );

    return;

  }


  renderStock(
    data || []
  );

}



/* =========================================================
   Render Stock
   ========================================================= */

function renderStock(data) {

  $("stockRows").innerHTML =
    data
      .map(x => {

        const location =
          locations.find(
            l =>
              Number(l.id) ===
              Number(x.location_id)
          );


        return `

<tr>

<td>
${esc(x.gtin)}
</td>

<td>
${esc(x.lot)}
</td>

<td>
${esc(x.expiry)}
</td>

<td>
${esc(x.serial)}
</td>

<td>
${esc(
  location
    ? location.location_name
    : x.location_id
)}
</td>

<td>
<b>
${esc(x.quantity)}
</b>
</td>

</tr>

`;

      })
      .join("");

}



/* =========================================================
   Summary
   ========================================================= */

function renderSummary(data) {

  const map =
    new Map();


  for (
    const x of data
  ) {

    const key =
      [
        x.gtin || "",
        x.lot || "",
        x.expiry || "",
        x.serial || ""
      ].join("|");


    map.set(
      key,
      (map.get(key) || 0) +
      Math.abs(
        Number(x.quantity) || 0
      )
    );

  }



  $("summaryRows").innerHTML =
    [...map.entries()]
      .map(
        ([key, qty]) => {

          const [
            gtin,
            lot,
            expiry,
            serial
          ] =
            key.split("|");


          return `

<tr>

<td>${esc(gtin)}</td>

<td>${esc(lot)}</td>

<td>${esc(expiry)}</td>

<td>${esc(serial)}</td>

<td>${qty}</td>

</tr>

`;

        }
      )
      .join("");

}



/* =========================================================
   Search
   ========================================================= */

$("search").oninput =
  e => {

    const q =
      e.target.value
        .trim()
        .toLowerCase();


    if (!q) {

      renderMovements(
        allMovements
      );

      return;

    }


    const filtered =
      allMovements.filter(
        x =>
          [
            x.gtin,
            x.lot,
            x.expiry,
            x.serial,
            x.reference_no,
            x.movement_type
          ]
            .some(
              v =>
                String(
                  v || ""
                )
                .toLowerCase()
                .includes(q)
            )
      );


    renderMovements(
      filtered
    );

  };



/* =========================================================
   Manual GS1
   ========================================================= */

$("parse").onclick =
  async () => {

    try {

      const result =
        parseGS1(
          $("raw").value
        );


      await showResult(
        result,
        "MANUAL/GS1"
      );

    }

    catch (e) {

      alert(
        "تعذر التحليل:\n" +
        e.message
      );

    }

  };



/* =========================================================
   Save Button
   ========================================================= */

$("save").onclick =
  saveMovement;



/* =========================================================
   Movement Type
   ========================================================= */

$("movementType").onchange =
  updateMovementUI;



/* =========================================================
   Camera
   ========================================================= */

$("start").onclick =
  async () => {

    if (!supabaseClient) {

      openSettings();

      return;

    }


    try {

      const ZX =
        window.ZXingBrowser ||
        window.ZXing;


      if (!ZX) {

        throw Error(
          "ZXingBrowser library لم يتم تحميلها."
        );

      }


      reader =
        new ZX.BrowserMultiFormatReader();


      const devices =
        await
        ZX.BrowserCodeReader
          .listVideoInputDevices();


      const device =
        devices.at(-1)
          ?.deviceId;


      controls =
        await
        reader.decodeFromVideoDevice(
          device,
          $("video"),
          async result => {

            if (!result)
              return;


            try {

              const text =
                result.getText();


              const type =
                result
                  .getBarcodeFormat
                  ?.()
                  ?.toString
                  ?.() ||
                "CAMERA";


              const parsed =
                parseGS1(
                  text
                );


              await showResult(
                parsed,
                type
              );


              controls?.stop();

              controls = null;


              $("stop").disabled =
                true;

              $("start").disabled =
                false;


              navigator
                .vibrate
                ?.(
                  100
                );

            }

            catch (e) {

              $("raw").value =
                result.getText();

            }

          }
        );


      $("start").disabled =
        true;

      $("stop").disabled =
        false;

    }

    catch (e) {

      alert(
        "تعذر تشغيل الكاميرا:\n" +
        e.message
      );

    }

  };



/* =========================================================
   Stop Camera
   ========================================================= */

$("stop").onclick =
  () => {

    controls?.stop();

    controls = null;

    $("stop").disabled =
      true;

    $("start").disabled =
      false;

  };



/* =========================================================
   Settings
   ========================================================= */

$("settingsBtn").onclick =
  openSettings;


$("setupBtn").onclick =
  openSettings;


$("closeSettings").onclick =
  closeSettings;



/* =========================================================
   Save Settings
   ========================================================= */

$("saveSettings").onclick =
  async () => {

    const url =
      $("supabaseUrl")
        .value
        .trim()
        .replace(
          /\/$/,
          ""
        );


    const key =
      $("supabaseKey")
        .value
        .trim();


    if (
      !/^https:\/\/.+\.supabase\.co/
        .test(url)
      ||
      !key
    ) {

      setStatus(
        "تأكد من Project URL و Publishable Key"
      );

      return;

    }


    localStorage.setItem(
      "gs1_sb_url",
      url
    );


    localStorage.setItem(
      "gs1_sb_key",
      key
    );


    const ok =
      await initSupabase();


    if (ok) {

      setStatus(
        "تم الاتصال بنجاح بقاعدة البيانات ✓",
        true
      );


      await loadMovements();

      await loadStock();


      setTimeout(
        closeSettings,
        500
      );

    }

    else {

      setStatus(
        "فشل الاتصال. راجع URL / Key و RLS"
      );

    }

  };



/* =========================================================
   Clear Settings
   ========================================================= */

$("clearSettings").onclick =
  () => {

    localStorage.removeItem(
      "gs1_sb_url"
    );

    localStorage.removeItem(
      "gs1_sb_key"
    );


    supabaseClient =
      null;


    $("configNotice")
      .classList
      .remove("hide");


    setStatus(
      "تم مسح الإعدادات"
    );

  };



/* =========================================================
   Refresh
   ========================================================= */

$("refresh").onclick =
  async () => {

    await loadMovements();

    await loadStock();

  };


$("refreshStock").onclick =
  loadStock;



/* =========================================================
   Excel Export
   ========================================================= */

$("export").onclick =
  () => {

    if (
      !allMovements.length
    ) {

      alert(
        "لا توجد حركات للتصدير"
      );

      return;

    }


    const data =
      allMovements.map(
        x => ({

          ID:
            x.id,

          Date:
            x.created_at,

          Movement:
            movementLabel(
              x.movement_type
            ),

          GTIN:
            x.gtin,

          LOT:
            x.lot,

          Expiry:
            x.expiry,

          Serial:
            x.serial,

          Quantity:
            x.quantity,

          Reference:
            x.reference_no,

          Location:
            x.location_id,

          From:
            x.from_location_id,

          To:
            x.to_location_id

        })
      );


    const ws =
      XLSX.utils
        .json_to_sheet(data);


    const wb =
      XLSX.utils.book_new();


    XLSX.utils.book_append_sheet(
      wb,
      ws,
      "Movements"
    );


    XLSX.writeFile(
      wb,
      `GS1_Movements_${
        new Date()
          .toISOString()
          .slice(0, 10)
      }.xlsx`
    );

  };



/* =========================================================
   Service Worker
   ========================================================= */

if (
  "serviceWorker"
  in navigator
) {

  navigator.serviceWorker
    .register("sw.js")
    .catch(
      () => {}
    );

}



/* =========================================================
   Initial Load
   ========================================================= */

(async () => {

  updateMovementUI();


  if (
    await initSupabase()
  ) {

    await loadMovements();

    await loadStock();

  }

})();
