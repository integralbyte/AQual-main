from flask import Flask, request, jsonify, render_template, Response
from werkzeug.utils import secure_filename
from docx import Document
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.shared import Pt
from docx.oxml.ns import nsmap
import re
import io
import html
import json
import base64
import sys
import time
import uuid
import urllib.parse
from pathlib import Path
import httpx
from google import genai
from google.genai import types

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from servers.config import get_env

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.logger.setLevel("INFO")

GEMINI_API_KEY = get_env("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3-flash-preview"
GEMINI_THINKING_LEVEL = "LOW"
ELEVENLABS_API_KEY = get_env("ELEVENLABS_API_KEY", "")
ELEVENLABS_TTS_VOICE_ID = get_env("ELEVENLABS_TTS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
ELEVENLABS_TTS_MODEL_ID = get_env("ELEVENLABS_TTS_MODEL_ID", "eleven_multilingual_v2")


def get_gemini_client():
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured. Set it in .env.")
    return genai.Client(api_key=GEMINI_API_KEY)

# Store images temporarily for the session
image_store = {}


def _set_cors_headers(response):
    origin = request.headers.get("Origin")
    response.headers["Access-Control-Allow-Origin"] = origin or "*"
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    if request.headers.get("Access-Control-Request-Private-Network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.after_request
def add_cors_headers(response):
    return _set_cors_headers(response)


def _log_gemini_event(event: str, **fields):
    payload = {"event": event, **fields}
    app.logger.info("[gemini] %s", json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def _log_tts_event(event: str, **fields):
    payload = {"event": event, **fields}
    app.logger.info("[tts] %s", json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def _extract_host(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    try:
        return urllib.parse.urlparse(url).netloc or ""
    except Exception:
        return ""


def _clean_ai_json_text(response_text: str) -> str:
    response_text = (response_text or "").strip()
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        response_text = "\n".join(lines).strip()
    return response_text


def _decode_data_url(data_url: str):
    match = re.match(r"^data:(?P<mime>[^;,]+)?(?P<b64>;base64)?,(?P<data>.*)$", data_url, re.DOTALL)
    if not match:
        raise ValueError("Invalid data URL")

    mime_type = (match.group("mime") or "image/png").strip()
    payload = match.group("data") or ""
    if match.group("b64"):
        image_bytes = base64.b64decode(payload)
    else:
        image_bytes = urllib.parse.unquote_to_bytes(payload)
    return image_bytes, mime_type


def _load_web_image_payload(data: dict):
    image_data = data.get("imageData")
    content_type = (data.get("contentType") or "").split(";", 1)[0].strip()
    image_url = (data.get("imageUrl") or "").strip()

    if image_data:
        image_bytes = base64.b64decode(image_data)
        if not content_type:
            content_type = "image/jpeg"
    elif image_url:
        if image_url.startswith("data:"):
            image_bytes, content_type = _decode_data_url(image_url)
        else:
            response = httpx.get(
                image_url,
                follow_redirects=True,
                timeout=20.0,
                headers={"User-Agent": "AQual/1.0"},
            )
            response.raise_for_status()
            image_bytes = response.content
            content_type = (response.headers.get("content-type") or "image/jpeg").split(";", 1)[0].strip()
    else:
        raise ValueError("No image input provided")

    if not image_bytes:
        raise ValueError("Image is empty")
    if len(image_bytes) > 15 * 1024 * 1024:
        raise ValueError("Image is too large")
    if not content_type.startswith("image/"):
        content_type = "image/jpeg"

    return image_bytes, content_type


def _generate_ai_json(client, parts, request_kind="generic", log_context=None):
    request_id = uuid.uuid4().hex[:10]
    started_at = time.perf_counter()
    context = dict(log_context or {})
    _log_gemini_event(
        "request_start",
        request_id=request_id,
        request_kind=request_kind,
        model=GEMINI_MODEL,
        thinking_level=GEMINI_THINKING_LEVEL,
        **context,
    )

    contents = [
        types.Content(
            role="user",
            parts=parts,
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_level=GEMINI_THINKING_LEVEL,
        ),
    )

    response_text = ""
    chunk_count = 0
    try:
        for chunk in client.models.generate_content_stream(
            model=GEMINI_MODEL,
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.text:
                response_text += chunk.text
                chunk_count += 1

        response_text = _clean_ai_json_text(response_text)
        parsed = json.loads(response_text)
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        _log_gemini_event(
            "request_success",
            request_id=request_id,
            request_kind=request_kind,
            duration_ms=duration_ms,
            response_chars=len(response_text),
            chunk_count=chunk_count,
            **context,
        )
        return parsed
    except Exception as e:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        _log_gemini_event(
            "request_error",
            request_id=request_id,
            request_kind=request_kind,
            duration_ms=duration_ms,
            error_type=type(e).__name__,
            error_message=str(e)[:240],
            response_chars=len(response_text),
            chunk_count=chunk_count,
            **context,
        )
        raise


class BionicHtmlConverter:
    """Converts DOCX files to HTML with bionic reading formatting."""

    # XML namespaces used in DOCX
    NSMAP = {
        'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    }

    def __init__(self, doc_id=None):
        self.css_classes = set()
        self.doc_id = doc_id
        self.image_counter = 0
        self.doc = None  # Will be set during convert

    def _get_fixation_length(self, word):
        """Calculates how many characters to bold for bionic reading."""
        clean_word = re.sub(r'\W+', '', word)
        length = len(clean_word)
        if length <= 1:
            return 1
        elif length <= 3:
            return int(length * 0.6) + 1
        else:
            return int(length * 0.45) + 1

    def _apply_bionic_to_text(self, text, is_already_bold=False):
        """Apply bionic reading formatting to text, returning HTML."""
        if is_already_bold:
            return f'<strong>{html.escape(text)}</strong>'

        parts = re.split(r'(\s+)', text)
        result = []

        for part in parts:
            if not part.strip() or not any(c.isalnum() for c in part):
                result.append(html.escape(part))
            else:
                fixation = self._get_fixation_length(part)
                bold_segment = html.escape(part[:fixation])
                normal_segment = html.escape(part[fixation:]) if len(part) > fixation else ''
                result.append(f'<strong class="bionic">{bold_segment}</strong>{normal_segment}')

        return ''.join(result)

    def _get_run_style(self, run):
        """Extract inline styles from a run."""
        styles = []

        if run.italic:
            styles.append('font-style: italic')
        if run.underline:
            styles.append('text-decoration: underline')
        if run.font.color and run.font.color.rgb:
            rgb = run.font.color.rgb
            styles.append(f'color: #{rgb}')
        if run.font.size:
            pt_size = run.font.size.pt
            styles.append(f'font-size: {pt_size}pt')
        if run.font.name:
            styles.append(f'font-family: "{run.font.name}", sans-serif')

        return '; '.join(styles) if styles else None

    def _get_hyperlink_url(self, hyperlink_elem):
        """Extract URL from a hyperlink element."""
        r_id = hyperlink_elem.get(f'{{{self.NSMAP["r"]}}}id')
        if r_id and self.doc:
            try:
                rel = self.doc.part.rels.get(r_id)
                if rel and rel.target_ref:
                    return rel.target_ref
            except Exception:
                pass
        return None

    def _process_run(self, run, hyperlink_url=None):
        """Process a single run and return HTML."""
        text = run.text
        if not text:
            return ''

        style = self._get_run_style(run)
        style_attr = f' style="{style}"' if style else ''

        is_bold = run.bold is True
        bionic_html = self._apply_bionic_to_text(text, is_bold)

        if style:
            bionic_html = f'<span{style_attr}>{bionic_html}</span>'

        if hyperlink_url:
            return f'<a href="{html.escape(hyperlink_url)}" class="doc-link" target="_blank">{bionic_html}</a>'

        return bionic_html

    def _process_paragraph_content(self, paragraph):
        """Process paragraph content including hyperlinks."""
        content_parts = []
        p_elem = paragraph._p

        # Iterate through child elements to preserve order and detect hyperlinks
        for child in p_elem:
            tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag

            if tag == 'r':  # Regular run
                # Find the corresponding run object
                for run in paragraph.runs:
                    if run._r == child:
                        content_parts.append(self._process_run(run))
                        break

            elif tag == 'hyperlink':  # Hyperlink
                url = self._get_hyperlink_url(child)
                # Process runs inside the hyperlink
                for r_elem in child.findall(f'{{{self.NSMAP["w"]}}}r'):
                    # Get text from the run
                    text_elems = r_elem.findall(f'{{{self.NSMAP["w"]}}}t')
                    for t_elem in text_elems:
                        if t_elem.text:
                            # Check for bold
                            rPr = r_elem.find(f'{{{self.NSMAP["w"]}}}rPr')
                            is_bold = False
                            if rPr is not None:
                                bold_elem = rPr.find(f'{{{self.NSMAP["w"]}}}b')
                                is_bold = bold_elem is not None

                            bionic_text = self._apply_bionic_to_text(t_elem.text, is_bold)
                            if url:
                                content_parts.append(f'<a href="{html.escape(url)}" class="doc-link" target="_blank">{bionic_text}</a>')
                            else:
                                content_parts.append(bionic_text)

        # Fallback if no content was extracted (handles simple paragraphs)
        if not content_parts:
            for run in paragraph.runs:
                content_parts.append(self._process_run(run))

        return ''.join(content_parts)

    def _get_list_info(self, paragraph):
        """Get list numbering info (type and level) from paragraph."""
        p_elem = paragraph._p
        numPr = p_elem.find(f'.//{{{self.NSMAP["w"]}}}numPr')

        if numPr is None:
            # Check style for list
            style_name = paragraph.style.name.lower() if paragraph.style else ''
            if 'list' in style_name:
                return {'is_list': True, 'level': 0, 'is_ordered': 'number' in style_name or 'decimal' in style_name}
            return None

        ilvl_elem = numPr.find(f'{{{self.NSMAP["w"]}}}ilvl')
        numId_elem = numPr.find(f'{{{self.NSMAP["w"]}}}numId')

        level = int(ilvl_elem.get(f'{{{self.NSMAP["w"]}}}val', 0)) if ilvl_elem is not None else 0
        num_id = numId_elem.get(f'{{{self.NSMAP["w"]}}}val') if numId_elem is not None else None

        # Try to determine if ordered or unordered from numbering definitions
        is_ordered = False
        if num_id and self.doc:
            try:
                numbering_part = self.doc.part.numbering_part
                if numbering_part:
                    # Check the abstract numbering for this numId
                    numbering_xml = numbering_part._element
                    for num in numbering_xml.findall(f'.//{{{self.NSMAP["w"]}}}num'):
                        if num.get(f'{{{self.NSMAP["w"]}}}numId') == num_id:
                            abstract_id = num.find(f'{{{self.NSMAP["w"]}}}abstractNumId')
                            if abstract_id is not None:
                                abs_id = abstract_id.get(f'{{{self.NSMAP["w"]}}}val')
                                for abstract in numbering_xml.findall(f'.//{{{self.NSMAP["w"]}}}abstractNum'):
                                    if abstract.get(f'{{{self.NSMAP["w"]}}}abstractNumId') == abs_id:
                                        for lvl in abstract.findall(f'{{{self.NSMAP["w"]}}}lvl'):
                                            if lvl.get(f'{{{self.NSMAP["w"]}}}ilvl') == str(level):
                                                numFmt = lvl.find(f'{{{self.NSMAP["w"]}}}numFmt')
                                                if numFmt is not None:
                                                    fmt = numFmt.get(f'{{{self.NSMAP["w"]}}}val', '')
                                                    is_ordered = fmt in ('decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman')
                                                break
                                        break
                            break
            except Exception:
                pass

        return {'is_list': True, 'level': level, 'is_ordered': is_ordered, 'num_id': num_id}

    def _get_paragraph_indent(self, paragraph):
        """Get paragraph indentation in ems."""
        p_elem = paragraph._p
        pPr = p_elem.find(f'{{{self.NSMAP["w"]}}}pPr')
        if pPr is None:
            return 0

        ind = pPr.find(f'{{{self.NSMAP["w"]}}}ind')
        if ind is None:
            return 0

        # Get left indentation in twips (1/20 of a point)
        left = ind.get(f'{{{self.NSMAP["w"]}}}left') or ind.get(f'{{{self.NSMAP["w"]}}}start') or '0'
        try:
            twips = int(left)
            # Convert to approximate ems (720 twips = 0.5 inch ≈ 2em)
            return round(twips / 360, 1)
        except ValueError:
            return 0

    def _get_paragraph_tag_and_class(self, paragraph):
        """Determine the appropriate HTML tag based on paragraph style."""
        style_name = paragraph.style.name.lower() if paragraph.style else ''

        if 'heading 1' in style_name:
            return 'h1', 'doc-heading doc-h1'
        elif 'heading 2' in style_name:
            return 'h2', 'doc-heading doc-h2'
        elif 'heading 3' in style_name:
            return 'h3', 'doc-heading doc-h3'
        elif 'heading 4' in style_name:
            return 'h4', 'doc-heading doc-h4'
        elif 'heading 5' in style_name:
            return 'h5', 'doc-heading doc-h5'
        elif 'heading 6' in style_name:
            return 'h6', 'doc-heading doc-h6'
        elif 'title' in style_name:
            return 'h1', 'doc-title'
        elif 'subtitle' in style_name:
            return 'h2', 'doc-subtitle'
        else:
            return 'p', 'doc-paragraph'

    def _get_alignment_style(self, paragraph):
        """Get CSS text-align from paragraph alignment."""
        alignment = paragraph.alignment
        if alignment == WD_PARAGRAPH_ALIGNMENT.CENTER:
            return 'text-align: center'
        elif alignment == WD_PARAGRAPH_ALIGNMENT.RIGHT:
            return 'text-align: right'
        elif alignment == WD_PARAGRAPH_ALIGNMENT.JUSTIFY:
            return 'text-align: justify'
        return None

    def _process_paragraph(self, paragraph, skip_list_check=False):
        """Process a paragraph and return HTML."""
        text = paragraph.text.strip()
        if not text:
            return '<p class="doc-paragraph">&nbsp;</p>'

        # Check for list
        if not skip_list_check:
            list_info = self._get_list_info(paragraph)
            if list_info:
                return None  # Will be handled by list processing

        tag, css_class = self._get_paragraph_tag_and_class(paragraph)
        alignment = self._get_alignment_style(paragraph)
        indent = self._get_paragraph_indent(paragraph)

        content = self._process_paragraph_content(paragraph)

        styles = []
        if alignment:
            styles.append(alignment)
        if indent > 0:
            styles.append(f'margin-left: {indent}em')

        style_attr = f' style="{"; ".join(styles)}"' if styles else ''

        return f'<{tag} class="{css_class}"{style_attr}>{content}</{tag}>'

    def _extract_images_from_paragraph(self, paragraph, doc):
        """Extract images from a paragraph and return HTML for them."""
        images_html = []

        # Look for drawings in the paragraph XML
        for run in paragraph.runs:
            run_xml = run._r
            drawings = run_xml.findall('.//' + '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')

            for drawing in drawings:
                # Find the blip element which contains the image reference
                blips = drawing.findall('.//' + '{http://schemas.openxmlformats.org/drawingml/2006/main}blip')

                for blip in blips:
                    embed_id = blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                    if embed_id:
                        try:
                            image_part = doc.part.related_parts.get(embed_id)
                            if image_part:
                                image_bytes = image_part.blob
                                content_type = image_part.content_type

                                # Generate image ID
                                img_id = f"{self.doc_id}_{self.image_counter}"
                                self.image_counter += 1

                                # Store image data
                                image_store[img_id] = {
                                    'data': base64.b64encode(image_bytes).decode('utf-8'),
                                    'content_type': content_type
                                }

                                # Create base64 data URL for display
                                data_url = f"data:{content_type};base64,{base64.b64encode(image_bytes).decode('utf-8')}"

                                images_html.append(
                                    f'<div class="doc-image-container">'
                                    f'<img src="{data_url}" class="doc-image" data-image-id="{img_id}" alt="Document image">'
                                    f'<div class="image-description" style="display:none;"></div>'
                                    f'</div>'
                                )
                        except Exception:
                            pass

        return images_html

    def _process_table(self, table):
        """Process a table and return HTML."""
        rows_html = []

        for row in table.rows:
            cells_html = []
            for cell in row.cells:
                cell_content = []
                for paragraph in cell.paragraphs:
                    if paragraph.text.strip():
                        # For table cells, we process inline without the paragraph wrapper
                        parts = []
                        for run in paragraph.runs:
                            parts.append(self._process_run(run))
                        cell_content.append(''.join(parts))
                    else:
                        cell_content.append('&nbsp;')

                cells_html.append(f'<td class="doc-table-cell">{"<br>".join(cell_content)}</td>')

            rows_html.append(f'<tr>{"".join(cells_html)}</tr>')

        return f'<table class="doc-table"><tbody>{"".join(rows_html)}</tbody></table>'

    def convert(self, docx_file):
        """Convert a DOCX file to HTML with bionic reading formatting."""
        doc = Document(docx_file)
        self.doc = doc  # Store reference for helper methods
        html_parts = []

        # Track list state for proper nested list handling
        # Stack holds tuples of (is_ordered, level)
        list_stack = []
        current_list_items = []

        def close_lists_to_level(target_level):
            """Close nested lists down to target level."""
            nonlocal list_stack, current_list_items
            while list_stack and list_stack[-1][1] >= target_level:
                is_ordered, level = list_stack.pop()
                tag = 'ol' if is_ordered else 'ul'
                if current_list_items:
                    list_html = f'<{tag} class="doc-list doc-list-level-{level}">{"".join(current_list_items)}</{tag}>'
                    if list_stack:
                        # Nest inside parent list item
                        current_list_items = [list_html]
                    else:
                        html_parts.append(list_html)
                        current_list_items = []

        def close_all_lists():
            """Close all open lists."""
            nonlocal list_stack, current_list_items
            while list_stack:
                is_ordered, level = list_stack.pop()
                tag = 'ol' if is_ordered else 'ul'
                if current_list_items:
                    list_html = f'<{tag} class="doc-list doc-list-level-{level}">{"".join(current_list_items)}</{tag}>'
                    if list_stack:
                        current_list_items = [list_html]
                    else:
                        html_parts.append(list_html)
                        current_list_items = []

        for element in doc.element.body:
            # Check if it's a paragraph
            if element.tag.endswith('p'):
                for paragraph in doc.paragraphs:
                    if paragraph._p == element:
                        # Extract any images from this paragraph
                        images = self._extract_images_from_paragraph(paragraph, doc)
                        for img_html in images:
                            close_all_lists()
                            html_parts.append(img_html)

                        # Check for list formatting
                        list_info = self._get_list_info(paragraph)

                        if list_info:
                            level = list_info['level']
                            is_ordered = list_info['is_ordered']

                            # Handle list level changes
                            if not list_stack:
                                # Starting a new list
                                list_stack.append((is_ordered, level))
                                current_list_items = []
                            elif level > list_stack[-1][1]:
                                # Going deeper - start nested list
                                list_stack.append((is_ordered, level))
                            elif level < list_stack[-1][1]:
                                # Going up - close nested lists
                                while list_stack and list_stack[-1][1] > level:
                                    old_ordered, old_level = list_stack.pop()
                                    tag = 'ol' if old_ordered else 'ul'
                                    if current_list_items:
                                        nested_html = f'<{tag} class="doc-list doc-list-level-{old_level}">{"".join(current_list_items)}</{tag}>'
                                        current_list_items = [f'<li class="doc-list-item">{nested_html}</li>']

                                if not list_stack:
                                    list_stack.append((is_ordered, level))

                            # Process list item content using the hyperlink-aware method
                            if paragraph.text.strip():
                                content = self._process_paragraph_content(paragraph)
                                indent = self._get_paragraph_indent(paragraph)
                                style = f' style="margin-left: {indent}em"' if indent > 0 else ''
                                current_list_items.append(f'<li class="doc-list-item"{style}>{content}</li>')
                        else:
                            # Not a list item - close any open lists
                            close_all_lists()

                            if paragraph.text.strip():
                                para_html = self._process_paragraph(paragraph, skip_list_check=True)
                                if para_html:
                                    html_parts.append(para_html)
                        break

            # Check if it's a table
            elif element.tag.endswith('tbl'):
                close_all_lists()

                for table in doc.tables:
                    if table._tbl == element:
                        html_parts.append(self._process_table(table))
                        break

        # Close any remaining open lists
        close_all_lists()

        return '\n'.join(html_parts)


@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html')


@app.route('/convert', methods=['POST'])
def convert_docx():
    """Handle DOCX file upload and conversion."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not file.filename.lower().endswith('.docx'):
        return jsonify({'error': 'Only DOCX files are supported'}), 400

    try:
        # Read file into memory
        file_bytes = io.BytesIO(file.read())

        # Generate a unique document ID for image storage
        import uuid
        doc_id = str(uuid.uuid4())[:8]

        # Convert to HTML with bionic reading
        converter = BionicHtmlConverter(doc_id=doc_id)
        html_content = converter.convert(file_bytes)

        return jsonify({
            'success': True,
            'html': html_content,
            'filename': secure_filename(file.filename),
            'docId': doc_id
        })

    except Exception as e:
        return jsonify({'error': f'Failed to process document: {str(e)}'}), 500


@app.route('/summarize', methods=['POST'])
def summarize_paragraph():
    """Summarize a paragraph into bullet points using Gemini."""
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({'error': 'No text provided'}), 400

    text = data['text'].strip()
    if not text:
        return jsonify({'error': 'Empty text'}), 400

    try:
        client = get_gemini_client()

        prompt = f"""Summarize the following paragraph into concise bullet points.
Return ONLY valid JSON in this exact format, nothing else:
{{"bullets": ["point 1", "point 2", "point 3"]}}

Paragraph:
{text}"""

        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=prompt),
                ],
            ),
        ]

        generate_content_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level="LOW",
            ),
        )

        response_text = ""
        for chunk in client.models.generate_content_stream(
            model="gemini-3-flash-preview",
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.text:
                response_text += chunk.text

        response_text = response_text.strip()

        # Clean up response - remove markdown code blocks if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        result = json.loads(response_text)
        return jsonify(result)

    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/rephrase', methods=['POST'])
def rephrase_paragraph():
    """Rephrase a paragraph using Gemini, optionally matching a writing style."""
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({'error': 'No text provided'}), 400

    text = data['text'].strip()
    if not text:
        return jsonify({'error': 'Empty text'}), 400

    writing_sample = data.get('writingSample', '').strip()

    try:
        client = get_gemini_client()

        if writing_sample:
            prompt = f"""You are a writing assistant. Rephrase the following paragraph to match the writing style, vocabulary level, and tone of the provided writing sample.

WRITING SAMPLE (match this style):
{writing_sample}

PARAGRAPH TO REPHRASE:
{text}

Return ONLY valid JSON in this exact format, nothing else:
{{
  "rephrased": "the rephrased paragraph here",
  "terms": [
    {{"word": "difficult word", "definition": "simple definition"}},
    {{"word": "another term", "definition": "its definition"}}
  ]
}}

The "terms" array should contain any words or phrases in your rephrased text that might be unfamiliar or technical to a general reader. Keep definitions concise (under 15 words)."""
        else:
            prompt = f"""You are a writing assistant. Rephrase the following paragraph to make it clearer and easier to understand while preserving the original meaning. Use simpler vocabulary where possible, but don't oversimplify technical concepts.

PARAGRAPH TO REPHRASE:
{text}

Return ONLY valid JSON in this exact format, nothing else:
{{
  "rephrased": "the rephrased paragraph here",
  "terms": [
    {{"word": "difficult word", "definition": "simple definition"}},
    {{"word": "another term", "definition": "its definition"}}
  ]
}}

The "terms" array should contain any words or phrases in your rephrased text that might be unfamiliar or technical to a general reader. Keep definitions concise (under 15 words). If there are no difficult terms, return an empty array."""

        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=prompt),
                ],
            ),
        ]

        generate_content_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level="LOW",
            ),
        )

        response_text = ""
        for chunk in client.models.generate_content_stream(
            model="gemini-3-flash-preview",
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.text:
                response_text += chunk.text

        response_text = response_text.strip()

        # Clean up response - remove markdown code blocks if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        result = json.loads(response_text)
        return jsonify(result)

    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/extract-text', methods=['POST'])
def extract_text():
    """Extract text from uploaded DOCX file for writing sample."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not file.filename.lower().endswith('.docx'):
        return jsonify({'error': 'Only DOCX files are supported'}), 400

    try:
        file_bytes = io.BytesIO(file.read())
        doc = Document(file_bytes)

        text_parts = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text_parts.append(paragraph.text.strip())

        # Limit to first ~2000 words for context
        full_text = '\n\n'.join(text_parts)
        words = full_text.split()
        if len(words) > 2000:
            full_text = ' '.join(words[:2000]) + '...'

        return jsonify({
            'success': True,
            'text': full_text,
            'filename': secure_filename(file.filename)
        })

    except Exception as e:
        return jsonify({'error': f'Failed to extract text: {str(e)}'}), 500


@app.route('/describe-image', methods=['POST'])
def describe_image():
    """Generate an accessibility description for an image using Gemini."""
    data = request.get_json()
    if not data or 'imageId' not in data:
        return jsonify({'error': 'No image ID provided'}), 400

    image_id = data['imageId']
    if image_id not in image_store:
        return jsonify({'error': 'Image not found'}), 404

    image_data = image_store[image_id]

    try:
        client = get_gemini_client()
        image_bytes = base64.b64decode(image_data['data'])

        prompt = """Describe this image for a visually impaired person. Provide a clear, detailed description that captures:
1. The main subject or content of the image
2. Important visual details (colors, layout, text if any)
3. The context or purpose of the image in a document

Keep the description concise but informative (2-4 sentences). Return ONLY valid JSON in this exact format:
{"description": "Your description here"}"""

        result = _generate_ai_json(
            client,
            [
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=image_data['content_type']
                ),
                types.Part.from_text(text=prompt),
            ],
            request_kind="bionic_doc_image_description",
            log_context={
                "route": "/describe-image",
                "source": "bionic_doc",
                "image_id": image_id,
                "image_bytes": len(image_bytes),
                "mime_type": image_data.get("content_type", ""),
                "prompt_chars": len(prompt),
            },
        )
        return jsonify(result)

    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/describe-web-image', methods=['POST', 'OPTIONS'])
def describe_web_image():
    """Generate an accessibility description for an arbitrary webpage image."""
    if request.method == 'OPTIONS':
        return _set_cors_headers(jsonify({'ok': True}))

    data = request.get_json() or {}
    raw_image_url = (data.get("imageUrl") or "").strip()

    try:
        image_bytes, content_type = _load_web_image_payload(data)
        client = get_gemini_client()

        if data.get("imageData"):
            input_mode = "base64"
        elif raw_image_url.startswith("data:"):
            input_mode = "data_url"
        elif raw_image_url:
            input_mode = "remote_url"
        else:
            input_mode = "unknown"

        alt_text = (data.get("altText") or "").strip()
        title_text = (data.get("titleText") or "").strip()
        nearby_text = (data.get("contextText") or "").strip()
        hint_parts = []
        if alt_text:
            hint_parts.append(f"ALT text: {alt_text[:180]}")
        if title_text and title_text.lower() != alt_text.lower():
            hint_parts.append(f"Title: {title_text[:140]}")
        if nearby_text:
            hint_parts.append(f"Nearby text: {nearby_text[:180]}")
        hint_block = " | ".join(hint_parts)

        prompt = """Describe this image for a visually impaired person. Provide a clear, detailed description that captures:
1. The main subject or content of the image
2. Important visual details (colors, layout, text if any)
3. The context or purpose of the image in a document

Keep the description concise but informative (2-4 sentences). Return ONLY valid JSON in this exact format:
{"description": "Your description here"}"""

        if hint_block:
            prompt += f"\n\nOptional on-page hints (can be wrong): {hint_block}"

        result = _generate_ai_json(
            client,
            [
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=content_type,
                ),
                types.Part.from_text(text=prompt),
            ],
            request_kind="web_image_description",
            log_context={
                "route": "/describe-web-image",
                "source": "webpage",
                "input_mode": input_mode,
                "image_host": _extract_host(raw_image_url),
                "page_host": _extract_host(data.get("pageUrl", "")),
                "image_bytes": len(image_bytes),
                "mime_type": content_type,
                "prompt_chars": len(prompt),
                "hint_chars": len(hint_block),
                "prompt_style": "bionic_like",
            },
        )
        description = (result.get("description") or "").strip()
        if not description:
            return jsonify({'error': 'Failed to generate description'}), 500
        return jsonify({"description": description})

    except httpx.HTTPStatusError as e:
        return jsonify({'error': f'Failed to fetch image URL ({e.response.status_code})'}), 400
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ask-web-image', methods=['POST', 'OPTIONS'])
def ask_web_image():
    """Answer follow-up questions about a webpage image."""
    if request.method == 'OPTIONS':
        return _set_cors_headers(jsonify({'ok': True}))

    data = request.get_json() or {}
    raw_image_url = (data.get("imageUrl") or "").strip()
    question = (data.get("question") or "").strip()
    if not question:
        return jsonify({'error': 'No follow-up question provided'}), 400

    try:
        image_bytes, content_type = _load_web_image_payload(data)
        client = get_gemini_client()

        if data.get("imageData"):
            input_mode = "base64"
        elif raw_image_url.startswith("data:"):
            input_mode = "data_url"
        elif raw_image_url:
            input_mode = "remote_url"
        else:
            input_mode = "unknown"

        base_description = (data.get("description") or "").strip()
        history = data.get("history") or []
        history_lines = []
        for item in history[-8:]:
            if not isinstance(item, dict):
                continue
            role = (item.get("role") or "").strip().lower()
            content = (item.get("content") or "").strip()
            if role not in ("user", "assistant") or not content:
                continue
            history_lines.append(f"{role.upper()}: {content[:600]}")
        history_block = "\n".join(history_lines) if history_lines else "None."

        prompt = f"""You are helping a visually impaired user understand one image from a webpage.

Base description:
{base_description or "None."}

Conversation so far:
{history_block}

User follow-up question:
{question}

Answer the question directly and clearly in 1-3 short paragraphs.
If the question cannot be answered from the image, say so briefly.
Return ONLY valid JSON in this exact format:
{{"answer": "your answer"}}"""

        result = _generate_ai_json(
            client,
            [
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=content_type,
                ),
                types.Part.from_text(text=prompt),
            ],
            request_kind="web_image_followup",
            log_context={
                "route": "/ask-web-image",
                "source": "webpage",
                "input_mode": input_mode,
                "image_host": _extract_host(raw_image_url),
                "page_host": _extract_host(data.get("pageUrl", "")),
                "image_bytes": len(image_bytes),
                "mime_type": content_type,
                "prompt_chars": len(prompt),
                "question_chars": len(question),
                "history_items": len(history_lines),
            },
        )
        answer = (result.get("answer") or "").strip()
        if not answer:
            return jsonify({'error': 'Failed to generate answer'}), 500
        return jsonify({"answer": answer})

    except httpx.HTTPStatusError as e:
        return jsonify({'error': f'Failed to fetch image URL ({e.response.status_code})'}), 400
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/speak-text', methods=['POST', 'OPTIONS'])
def speak_text():
    """Convert selected text to speech using ElevenLabs."""
    if request.method == 'OPTIONS':
        return _set_cors_headers(jsonify({'ok': True}))

    data = request.get_json() or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    if not ELEVENLABS_API_KEY:
        return jsonify({'error': 'ELEVENLABS_API_KEY is not configured. Set it in .env.'}), 500

    voice_id = (data.get("voiceId") or ELEVENLABS_TTS_VOICE_ID or "").strip()
    if not voice_id:
        return jsonify({'error': 'No ElevenLabs voice ID configured'}), 500

    text = text[:2500]
    request_id = uuid.uuid4().hex[:10]
    started_at = time.perf_counter()
    _log_tts_event(
        "request_start",
        request_id=request_id,
        route="/speak-text",
        voice_id=voice_id,
        model_id=ELEVENLABS_TTS_MODEL_ID,
        text_chars=len(text),
    )

    payload = {
        "text": text,
        "model_id": ELEVENLABS_TTS_MODEL_ID
    }
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(voice_id, safe='')}/stream"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=45.0)
        if response.status_code >= 400:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            _log_tts_event(
                "request_error",
                request_id=request_id,
                route="/speak-text",
                duration_ms=duration_ms,
                status_code=response.status_code,
                body_preview=(response.text or "")[:200],
            )
            return jsonify({'error': f'ElevenLabs TTS failed ({response.status_code})'}), 502

        audio_bytes = response.content
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        _log_tts_event(
            "request_success",
            request_id=request_id,
            route="/speak-text",
            duration_ms=duration_ms,
            status_code=response.status_code,
            audio_bytes=len(audio_bytes),
        )
        return Response(
            audio_bytes,
            mimetype="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    except httpx.RequestError as e:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        _log_tts_event(
            "request_error",
            request_id=request_id,
            route="/speak-text",
            duration_ms=duration_ms,
            error_type=type(e).__name__,
            error_message=str(e)[:240],
        )
        return jsonify({'error': 'Could not reach ElevenLabs TTS service'}), 502
    except Exception as e:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        _log_tts_event(
            "request_error",
            request_id=request_id,
            route="/speak-text",
            duration_ms=duration_ms,
            error_type=type(e).__name__,
            error_message=str(e)[:240],
        )
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=8080)
