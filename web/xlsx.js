/* 地図画像とKMLのオートシェイプを年代別シートにした xlsx を作る。 */
(function (root) {
  const EMU = 9525;

  function crc32(bytes) {
    let c = ~0;
    for (let i = 0; i < bytes.length; i += 1) {
      c ^= bytes[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function concat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function u16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function u32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function zipStore(files) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
      const name = utf8(file.name);
      const data = file.data;
      const crc = crc32(data);
      const local = new Uint8Array(30);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50);
      u16(lv, 4, 20);
      u16(lv, 6, 0);
      u16(lv, 8, 0);
      u16(lv, 10, time);
      u16(lv, 12, date);
      u32(lv, 14, crc);
      u32(lv, 18, data.length);
      u32(lv, 22, data.length);
      u16(lv, 26, name.length);
      u16(lv, 28, 0);
      locals.push(local, name, data);

      const central = new Uint8Array(46);
      const cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20);
      u16(cv, 6, 20);
      u16(cv, 8, 0);
      u16(cv, 10, 0);
      u16(cv, 12, time);
      u16(cv, 14, date);
      u32(cv, 16, crc);
      u32(cv, 20, data.length);
      u32(cv, 24, data.length);
      u16(cv, 28, name.length);
      u16(cv, 30, 0);
      u16(cv, 32, 0);
      u16(cv, 34, 0);
      u16(cv, 36, 0);
      u32(cv, 38, 0);
      u32(cv, 42, offset);
      centrals.push(central, name);
      offset += local.length + name.length + data.length;
    }
    const centralDir = concat(centrals);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054b50);
    u16(ev, 4, 0);
    u16(ev, 6, 0);
    u16(ev, 8, files.length);
    u16(ev, 10, files.length);
    u32(ev, 12, centralDir.length);
    u32(ev, 16, offset);
    u16(ev, 20, 0);
    return concat(locals.concat([centralDir, end]));
  }

  function xmlEscape(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    }[ch]));
  }

  function sheetName(raw, used) {
    let name = String(raw).replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim();
    if (!name) name = "地図";
    name = name.slice(0, 31);
    const base = name;
    let n = 2;
    while (used.has(name)) {
      const suffix = ` ${n}`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
      n += 1;
    }
    used.add(name);
    return name;
  }

  function colorHex(color) {
    const raw = String(color || "#c4452d").replace("#", "");
    return (raw.length === 6 ? raw : "c4452d").toUpperCase();
  }

  function dashXml(kind) {
    const map = { dash: "dash", dot: "sysDot", chain: "dashDot", chain2: "lgDashDotDot" };
    const value = map[kind];
    return value ? `<a:prstDash val="${value}"/>` : "";
  }

  function shapeXml(shape, id) {
    const stroke = Math.max(1, Number(shape.width) || 3);
    const color = colorHex(shape.color);
    if (shape.kind === "point") {
      const [x, y] = shape.points[0];
      const r = Math.max(stroke + 1, 4);
      const cx = Math.round(r * 2 * EMU);
      const offX = Math.round((x - r) * EMU);
      const offY = Math.round((y - r) * EMU);
      return `<xdr:absoluteAnchor><xdr:pos x="${offX}" y="${offY}"/><xdr:ext cx="${cx}" cy="${cx}"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xmlEscape(shape.name)}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cx}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln w="${Math.round(1.5 * EMU)}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`;
    }
    const pts = shape.points;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const pad = stroke;
    if (maxX - minX < pad) {
      const mid = (minX + maxX) / 2;
      minX = mid - pad / 2;
      maxX = mid + pad / 2;
    }
    if (maxY - minY < pad) {
      const mid = (minY + maxY) / 2;
      minY = mid - pad / 2;
      maxY = mid + pad / 2;
    }
    const width = Math.round((maxX - minX) * EMU);
    const height = Math.round((maxY - minY) * EMU);
    const offX = Math.round(minX * EMU);
    const offY = Math.round(minY * EMU);
    const commands = pts.map(([x, y], index) => {
      const px = Math.round((x - minX) * EMU);
      const py = Math.round((y - minY) * EMU);
      const tag = index === 0 ? "a:moveTo" : "a:lnTo";
      return `<${tag}><a:pt x="${px}" y="${py}"/></${tag}>`;
    }).join("");
    return `<xdr:absoluteAnchor><xdr:pos x="${offX}" y="${offY}"/><xdr:ext cx="${width}" cy="${height}"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xmlEscape(shape.name)}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="${width}" h="${height}">${commands}</a:path></a:pathLst></a:custGeom><a:noFill/><a:ln w="${Math.round(stroke * EMU)}" cap="rnd" cmpd="sng"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashXml(shape.dash)}</a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`;
  }

  function pictureXml(width, height) {
    const cx = Math.round(width * EMU);
    const cy = Math.round(height * EMU);
    return `<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="地図"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor>`;
  }

  function drawingXml(sheet) {
    const parts = [pictureXml(sheet.width, sheet.height)];
    sheet.shapes.forEach((shape, index) => {
      parts.push(shapeXml(shape, index + 2));
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${parts.join("")}</xdr:wsDr>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Yu Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

  function worksheetXml(note) {
    const data = note
      ? `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${xmlEscape(note)}</t></is></c></row></sheetData>`
      : "<sheetData/>";
    const drawing = note ? "" : `<drawing r:id="rId1"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${data}${drawing}</worksheet>`;
  }

  function buildMapWorkbook(sheets) {
    const used = new Set();
    const named = sheets.map((sheet) => ({ ...sheet, name: sheetName(sheet.name, used), shapes: sheet.shapes || [] }));
    const files = [
      {
        name: "[Content_Types].xml",
        data: utf8(contentTypes(named)),
      },
      {
        name: "_rels/.rels",
        data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      },
      {
        name: "xl/styles.xml",
        data: utf8(STYLES),
      },
      {
        name: "xl/workbook.xml",
        data: utf8(workbookXml(named)),
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: utf8(workbookRels(named)),
      },
    ];
    named.forEach((sheet, index) => {
      const n = index + 1;
      files.push({ name: `xl/worksheets/sheet${n}.xml`, data: utf8(worksheetXml(sheet.note)) });
      if (sheet.note || !sheet.image) return;
      files.push({
        name: `xl/worksheets/_rels/sheet${n}.xml.rels`,
        data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`),
      });
      files.push({ name: `xl/drawings/drawing${n}.xml`, data: utf8(drawingXml(sheet)) });
      files.push({
        name: `xl/drawings/_rels/drawing${n}.xml.rels`,
        data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.jpg"/></Relationships>`),
      });
      files.push({ name: `xl/media/image${n}.jpg`, data: sheet.image });
    });
    return zipStore(files);
  }

  function contentTypes(sheets) {
    const overrides = [
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    ];
    sheets.forEach((sheet, index) => {
      const n = index + 1;
      overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      if (!sheet.note && sheet.image) {
        overrides.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      }
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>${overrides.join("")}</Types>`;
  }

  function workbookXml(sheets) {
    const items = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${items}</sheets></workbook>`;
  }

  function workbookRels(sheets) {
    const items = sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
    const styleId = sheets.length + 1;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}<Relationship Id="rId${styleId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  }

  root.buildMapWorkbook = buildMapWorkbook;
})(typeof window !== "undefined" ? window : globalThis);
