/**
 * Browser-side resume text extraction. Doing this on the client keeps the Cloudflare Worker
 * within the free plan's CPU budget and means the binary file never leaves the browser.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function extractResumeText(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Resume file must not exceed 10 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw new Error("Resume file cannot be empty.");
  const text = extension === "pdf" ? await pdfText(bytes) : extension === "docx" ? await docxText(bytes) : null;
  if (text === null) throw new Error("Only PDF and DOCX resumes are supported.");
  if (!text.trim()) throw new Error("The uploaded document does not contain extractable text.");
  return text;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text.join("\n");
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const entry = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" })["word/document.xml"];
  if (!entry) throw new Error("Unable to read this DOCX file.");
  const xml = new DOMParser().parseFromString(strFromU8(entry), "application/xml");
  const paragraphs: string[] = [];
  for (const paragraph of Array.from(xml.getElementsByTagName("w:p"))) {
    let line = "";
    for (const node of Array.from(paragraph.getElementsByTagName("*"))) {
      if (node.tagName === "w:t") line += node.textContent ?? "";
      else if (node.tagName === "w:tab") line += "\t";
      else if (node.tagName === "w:br") line += "\n";
    }
    paragraphs.push(line);
  }
  return paragraphs.join("\n");
}
