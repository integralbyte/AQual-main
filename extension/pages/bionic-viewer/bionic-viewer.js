        const API_BASE = 'http://localhost:8080';
        const uploadScreen = document.getElementById('uploadScreen');
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const selectFileBtn = document.getElementById('selectFileBtn');
        const loading = document.getElementById('loading');
        const viewer = document.getElementById('viewer');
        const documentContent = document.getElementById('documentContent');
        const filename = document.getElementById('filename');
        const errorMsg = document.getElementById('errorMsg');
        const settingsPanel = document.getElementById('settingsPanel');
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsCloseBtn = document.getElementById('settingsCloseBtn');
        const closeViewerBtn = document.getElementById('closeViewerBtn');
        const dyslexiaBtn = document.getElementById('dyslexiaBtn');
        const styleUploadZone = document.getElementById('styleUploadZone');
        const styleFileInput = document.getElementById('styleFileInput');
        const styleUploadLabel = document.getElementById('styleUploadLabel');
        const styleIndicator = document.getElementById('styleIndicator');
        const clearStyleBtn = document.getElementById('clearStyleBtn');
        const readingAssistToggleBtn = document.getElementById('readingAssistToggleBtn');

        let shiftPressed = false;
        let currentHighlight = null;
        let currentMode = 'summarize';
        let writingSample = '';
        let readingAssistEnabled = false;

        function applyReadingAssistState() {
            document.body.classList.toggle('reading-assist-off', !readingAssistEnabled);
            if (!readingAssistToggleBtn) return;
            readingAssistToggleBtn.textContent = `Bionic Reading: ${readingAssistEnabled ? 'On' : 'Off'}`;
            readingAssistToggleBtn.classList.toggle('active', readingAssistEnabled);
        }

        function toggleReadingAssist() {
            readingAssistEnabled = !readingAssistEnabled;
            applyReadingAssistState();
        }

        function loadStoredDocument() {
            if (!chrome?.storage?.local) return;
            chrome.storage.local.get('aqualBionicDocument', (stored) => {
                const doc = stored.aqualBionicDocument;
                if (!doc || !doc.html) return;
                filename.textContent = doc.filename || 'Document';
                documentContent.innerHTML = doc.html;
                uploadScreen.classList.add('hidden');
                viewer.classList.add('visible');
            });
        }

        // Mode toggle
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMode = btn.dataset.mode;
            });
        });

        // Track shift key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                shiftPressed = true;
                documentContent.classList.add('shift-mode');
            }

            // Enter key to process selected text
            if (e.key === 'Enter') {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();

                if (selectedText.length > 0 && viewer.classList.contains('visible')) {
                    e.preventDefault();
                    processSelectedText(selectedText);
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                shiftPressed = false;
                documentContent.classList.remove('shift-mode');

                if (currentHighlight) {
                    currentHighlight.classList.remove('highlight');
                    currentHighlight = null;
                }
            }
        });

        // Handle paragraph and image hover/click
        documentContent.addEventListener('mouseover', (e) => {
            if (!shiftPressed) return;

            // Check for image
            const imgContainer = e.target.closest('.doc-image-container');
            if (imgContainer && !imgContainer.classList.contains('loading') && !imgContainer.classList.contains('described')) {
                if (currentHighlight && currentHighlight !== imgContainer) {
                    currentHighlight.classList.remove('highlight');
                }
                imgContainer.classList.add('highlight');
                currentHighlight = imgContainer;
                return;
            }

            // Check for paragraph
            const para = e.target.closest('.doc-paragraph');
            if (para && !para.classList.contains('loading') && !para.classList.contains('summarized') && !para.classList.contains('rephrased')) {
                if (currentHighlight && currentHighlight !== para) {
                    currentHighlight.classList.remove('highlight');
                }
                para.classList.add('highlight');
                currentHighlight = para;
            }
        });

        documentContent.addEventListener('mouseout', (e) => {
            if (!shiftPressed) return;

            const imgContainer = e.target.closest('.doc-image-container');
            if (imgContainer && !e.relatedTarget?.closest('.doc-image-container')) {
                imgContainer.classList.remove('highlight');
                if (currentHighlight === imgContainer) currentHighlight = null;
                return;
            }

            const para = e.target.closest('.doc-paragraph');
            if (para && !e.relatedTarget?.closest('.doc-paragraph')) {
                para.classList.remove('highlight');
                if (currentHighlight === para) currentHighlight = null;
            }
        });

        documentContent.addEventListener('click', (e) => {
            if (!shiftPressed) return;
            if (e.target.classList.contains('restore-btn')) return;

            // Check for image click
            const imgContainer = e.target.closest('.doc-image-container');
            if (imgContainer && !imgContainer.classList.contains('loading') && !imgContainer.classList.contains('described')) {
                describeImage(imgContainer);
                return;
            }

            // Check for paragraph click
            const para = e.target.closest('.doc-paragraph');
            if (!para || para.classList.contains('loading') || para.classList.contains('summarized') || para.classList.contains('rephrased')) return;

            if (currentMode === 'summarize') {
                summarizeParagraph(para);
            } else {
                rephraseParagraph(para);
            }
        });

        async function summarizeParagraph(para) {
            const originalHtml = para.innerHTML;
            const originalText = para.textContent;

            para.classList.remove('highlight');
            para.classList.add('loading');

            // Wrap current content for animation
            const currentContent = para.innerHTML;
            para.innerHTML = `<div class="para-content">${currentContent}</div>`;

            try {
                const response = await fetch(`${API_BASE}/summarize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: originalText })
                });

                const data = await response.json();

                if (data.error) {
                    para.classList.remove('loading');
                    para.innerHTML = originalHtml;
                    console.error('Summarise error:', data.error);
                    return;
                }

                let bulletHtml = '<ul class="bullet-list">';
                for (const bullet of data.bullets) {
                    bulletHtml += `<li>${applyBionic(bullet)}</li>`;
                }
                bulletHtml += '</ul>';
                bulletHtml += '<button class="restore-btn" type="button">Show original</button>';

                // Animate out old content
                const oldContent = para.querySelector('.para-content');
                if (oldContent) {
                    oldContent.classList.add('fade-out');
                }

                await new Promise(r => setTimeout(r, 250));

                // Replace with new content and animate in
                para.innerHTML = `<div class="para-content fade-in">${bulletHtml}</div>`;
                para.classList.remove('loading');
                para.classList.add('summarized', 'success-flash');

                para.dataset.originalHtml = originalHtml;

                para.querySelector('.restore-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    animateRestore(para, 'summarized');
                });

                // Remove flash class after animation
                setTimeout(() => para.classList.remove('success-flash'), 600);

            } catch (err) {
                para.classList.remove('loading');
                para.innerHTML = originalHtml;
                console.error('Summarise failed:', err);
            }
        }

        async function rephraseParagraph(para) {
            const originalHtml = para.innerHTML;
            const originalText = para.textContent;

            para.classList.remove('highlight');
            para.classList.add('loading');

            // Wrap current content for animation
            const currentContent = para.innerHTML;
            para.innerHTML = `<div class="para-content">${currentContent}</div>`;

            try {
                const response = await fetch(`${API_BASE}/rephrase`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: originalText,
                        writingSample: writingSample
                    })
                });

                const data = await response.json();

                if (data.error) {
                    para.classList.remove('loading');
                    para.innerHTML = originalHtml;
                    console.error('Rephrase error:', data.error);
                    return;
                }

                // Apply bionic formatting and highlight terms
                let rephrasedHtml = '<div class="rephrased-text">' + applyBionicWithTerms(data.rephrased, data.terms || []) + '</div>';
                rephrasedHtml += '<button class="restore-btn" type="button">Show original</button>';

                // Animate out old content
                const oldContent = para.querySelector('.para-content');
                if (oldContent) {
                    oldContent.classList.add('fade-out');
                }

                await new Promise(r => setTimeout(r, 250));

                // Replace with new content and animate in
                para.innerHTML = `<div class="para-content fade-in">${rephrasedHtml}</div>`;
                para.classList.remove('loading');
                para.classList.add('rephrased', 'success-flash');

                para.dataset.originalHtml = originalHtml;

                para.querySelector('.restore-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    animateRestore(para, 'rephrased');
                });

                // Remove flash class after animation
                setTimeout(() => para.classList.remove('success-flash'), 600);

            } catch (err) {
                para.classList.remove('loading');
                para.innerHTML = originalHtml;
                console.error('Rephrase failed:', err);
            }
        }

        async function animateRestore(para, stateClass) {
            const content = para.querySelector('.para-content');
            if (content) {
                content.classList.add('fade-out');
                await new Promise(r => setTimeout(r, 250));
            }

            para.innerHTML = `<div class="para-content fade-in">${para.dataset.originalHtml}</div>`;
            para.classList.remove(stateClass);
            delete para.dataset.originalHtml;

            // Clean up wrapper after animation
            setTimeout(() => {
                const wrapper = para.querySelector('.para-content');
                if (wrapper) {
                    para.innerHTML = wrapper.innerHTML;
                }
            }, 400);
        }

        async function processSelectedText(selectedText) {
            const selection = window.getSelection();
            if (!selection.rangeCount) return;

            const range = selection.getRangeAt(0);

            // Find the paragraph containing the selection
            let container = range.commonAncestorContainer;
            if (container.nodeType === Node.TEXT_NODE) {
                container = container.parentElement;
            }

            // Walk up to find a paragraph, list item, or any P/LI tag within documentContent
            while (container && container !== documentContent && container !== document.body) {
                if (container.classList && container.classList.contains('doc-paragraph')) {
                    break;
                }
                if (container.classList && container.classList.contains('doc-list-item')) {
                    break;
                }
                if (container.tagName === 'P' && documentContent.contains(container)) {
                    break;
                }
                if (container.tagName === 'LI' && documentContent.contains(container)) {
                    break;
                }
                container = container.parentElement;
            }

            // Clear selection
            selection.removeAllRanges();

            // Process the containing element
            if (container && container !== documentContent && container !== document.body) {
                console.log('Processing container:', container.tagName, container.className);

                if (container.classList && container.classList.contains('doc-paragraph')) {
                    if (currentMode === 'summarize') {
                        summarizeParagraph(container);
                    } else {
                        rephraseParagraph(container);
                    }
                } else if (container.classList && container.classList.contains('doc-list-item')) {
                    processListItem(container, selectedText);
                } else if (container.tagName === 'P') {
                    // Fallback for P tags without doc-paragraph class
                    if (currentMode === 'summarize') {
                        summarizeParagraph(container);
                    } else {
                        rephraseParagraph(container);
                    }
                } else if (container.tagName === 'LI') {
                    processListItem(container, selectedText);
                }
            } else {
                console.log('No valid container found for selection');
            }
        }

        async function processListItem(item, selectedText) {
            const originalHtml = item.innerHTML;
            const textToProcess = selectedText || item.textContent;

            item.classList.add('loading');
            item.innerHTML = `<div class="para-content">${originalHtml}</div>`;

            try {
                const endpoint = currentMode === 'summarize' ? '/summarize' : '/rephrase';
                const body = currentMode === 'summarize'
                    ? { text: textToProcess }
                    : { text: textToProcess, writingSample };

                const response = await fetch(`${API_BASE}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                const data = await response.json();

                if (data.error) {
                    item.classList.remove('loading');
                    item.innerHTML = originalHtml;
                    console.error('Process error:', data.error);
                    return;
                }

                let resultHtml;
                const stateClass = currentMode === 'summarize' ? 'summarized' : 'rephrased';

                if (currentMode === 'summarize') {
                    resultHtml = '<ul class="bullet-list">';
                    for (const bullet of data.bullets) {
                        resultHtml += `<li>${applyBionic(bullet)}</li>`;
                    }
                    resultHtml += '</ul>';
                    resultHtml += '<button class="restore-btn" type="button">Show original</button>';
                } else {
                    resultHtml = '<div class="rephrased-text">' + applyBionicWithTerms(data.rephrased, data.terms || []) + '</div>';
                    resultHtml += '<button class="restore-btn" type="button">Show original</button>';
                }

                // Animate out old content
                const oldContent = item.querySelector('.para-content');
                if (oldContent) {
                    oldContent.classList.add('fade-out');
                }

                await new Promise(r => setTimeout(r, 250));

                // Replace with new content
                item.innerHTML = `<div class="para-content fade-in">${resultHtml}</div>`;
                item.classList.remove('loading');
                item.classList.add(stateClass, 'success-flash');
                item.dataset.originalHtml = originalHtml;

                item.querySelector('.restore-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    animateRestoreItem(item, stateClass);
                });

                setTimeout(() => item.classList.remove('success-flash'), 600);

            } catch (err) {
                item.classList.remove('loading');
                item.innerHTML = originalHtml;
                console.error('Process list item failed:', err);
            }
        }

        async function animateRestoreItem(item, stateClass) {
            const content = item.querySelector('.para-content');
            if (content) {
                content.classList.add('fade-out');
                await new Promise(r => setTimeout(r, 250));
            }

            item.innerHTML = `<div class="para-content fade-in">${item.dataset.originalHtml}</div>`;
            item.classList.remove(stateClass);
            delete item.dataset.originalHtml;

            setTimeout(() => {
                const wrapper = item.querySelector('.para-content');
                if (wrapper) {
                    item.innerHTML = wrapper.innerHTML;
                }
            }, 400);
        }

        async function describeImage(container) {
            const img = container.querySelector('.doc-image');
            const imageId = img?.dataset.imageId;
            if (!imageId) return;

            container.classList.remove('highlight');
            container.classList.add('loading');

            try {
                const response = await fetch(`${API_BASE}/describe-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageId })
                });

                const data = await response.json();

                if (data.error) {
                    container.classList.remove('loading');
                    console.error('Describe error:', data.error);
                    return;
                }

                const descDiv = container.querySelector('.image-description');
                const bionicDescription = applyBionic(data.description);
                descDiv.innerHTML = `
                    <span class="desc-label">Image Description</span>
                    <span class="desc-text">${bionicDescription}</span>
                    <button class="restore-btn" type="button">Hide description</button>
                `;
                descDiv.style.display = 'block';
                descDiv.classList.add('fade-in');

                container.classList.remove('loading');
                container.classList.add('described', 'success-flash');

                descDiv.querySelector('.restore-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    descDiv.style.display = 'none';
                    container.classList.remove('described');
                });

                setTimeout(() => container.classList.remove('success-flash'), 600);

            } catch (err) {
                container.classList.remove('loading');
                console.error('Describe failed:', err);
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function getFixationLength(word) {
            const clean = word.replace(/\W/g, '');
            const len = clean.length;
            if (len <= 1) return 1;
            if (len <= 3) return Math.floor(len * 0.6) + 1;
            return Math.floor(len * 0.45) + 1;
        }

        function applyBionic(text) {
            const parts = text.split(/(\s+)/);
            let result = '';
            for (const part of parts) {
                if (!part.trim() || !/[a-zA-Z0-9]/.test(part)) {
                    result += escapeHtml(part);
                } else {
                    const fix = getFixationLength(part);
                    const bold = escapeHtml(part.slice(0, fix));
                    const rest = escapeHtml(part.slice(fix));
                    result += `<strong class="bionic">${bold}</strong>${rest}`;
                }
            }
            return result;
        }

        function applyBionicWithTerms(text, terms) {
            // Sort terms by length (longest first) to handle overlapping terms
            const sortedTerms = [...terms].sort((a, b) => b.word.length - a.word.length);

            // Create placeholders for terms (using chars unlikely to appear in text)
            const placeholders = [];
            let processedText = text;

            sortedTerms.forEach((term, idx) => {
                const regex = new RegExp(`\\b(${escapeRegex(term.word)})\\b`, 'gi');
                processedText = processedText.replace(regex, (match) => {
                    const placeholderId = placeholders.length;
                    placeholders.push({
                        word: match,
                        definition: term.definition
                    });
                    return `\x00${placeholderId}\x00`;
                });
            });

            // Now split by whitespace and process
            const parts = processedText.split(/(\s+)/);
            let result = '';

            for (const part of parts) {
                // Check if this part contains a placeholder (may have punctuation around it)
                const placeholderMatch = part.match(/^([^\x00]*)\x00(\d+)\x00([^\x00]*)$/);
                if (placeholderMatch) {
                    const before = placeholderMatch[1];
                    const ph = placeholders[parseInt(placeholderMatch[2])];
                    const after = placeholderMatch[3];
                    const definition = escapeHtml(ph.definition);
                    const bionicPhrase = applyBionicToPhrase(ph.word);
                    result += escapeHtml(before) + `<span class="term-highlight" data-definition="${definition}">${bionicPhrase}</span>` + escapeHtml(after);
                } else if (!part.trim() || !/[a-zA-Z0-9]/.test(part)) {
                    result += escapeHtml(part);
                } else {
                    result += applyBionicToWord(part);
                }
            }

            return result;
        }

        function applyBionicToPhrase(phrase) {
            // Apply bionic to each word in a phrase
            const words = phrase.split(/(\s+)/);
            return words.map(w => {
                if (!w.trim() || !/[a-zA-Z0-9]/.test(w)) {
                    return escapeHtml(w);
                }
                return applyBionicToWord(w);
            }).join('');
        }

        function applyBionicToWord(word) {
            const fix = getFixationLength(word);
            const bold = escapeHtml(word.slice(0, fix));
            const rest = escapeHtml(word.slice(fix));
            return `<strong class="bionic">${bold}</strong>${rest}`;
        }

        function escapeRegex(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // Settings panel
        function toggleSettings() {
            settingsPanel.classList.toggle('visible');
        }

        selectFileBtn.addEventListener('click', () => {
            fileInput.click();
        });

        if (readingAssistToggleBtn) {
            readingAssistToggleBtn.addEventListener('click', toggleReadingAssist);
        }
        settingsBtn.addEventListener('click', toggleSettings);
        settingsCloseBtn.addEventListener('click', toggleSettings);
        closeViewerBtn.addEventListener('click', closeViewer);
        dyslexiaBtn.addEventListener('click', toggleDyslexia);
        clearStyleBtn.addEventListener('click', clearWritingStyle);

        // Writing style upload
        styleUploadZone.addEventListener('click', () => {
            styleFileInput.click();
        });

        styleFileInput.addEventListener('change', async (e) => {
            if (e.target.files.length === 0) return;

            const file = e.target.files[0];
            if (!file.name.toLowerCase().endsWith('.docx')) {
                alert('Please upload a DOCX file.');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch(`${API_BASE}/extract-text`, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();

                if (data.error) {
                    alert('Error: ' + data.error);
                    return;
                }

                writingSample = data.text;
                styleUploadLabel.textContent = data.filename;
                styleUploadZone.classList.add('has-file');
                styleIndicator.textContent = data.filename;
                styleIndicator.classList.add('has-style');
                clearStyleBtn.classList.add('visible');

            } catch (err) {
                alert('Failed to upload file.');
                console.error(err);
            }
        });

        function clearWritingStyle() {
            writingSample = '';
            styleFileInput.value = '';
            styleUploadLabel.textContent = 'Click to upload DOCX';
            styleUploadZone.classList.remove('has-file');
            styleIndicator.textContent = 'No style set';
            styleIndicator.classList.remove('has-style');
            clearStyleBtn.classList.remove('visible');
        }

        // Upload handlers
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                handleFile(e.dataTransfer.files[0]);
            }
        });

        uploadZone.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });

        function showError(msg) {
            errorMsg.textContent = msg;
            errorMsg.classList.add('visible');
        }

        function hideError() {
            errorMsg.classList.remove('visible');
        }

        function handleFile(file) {
            hideError();

            if (!file.name.toLowerCase().endsWith('.docx')) {
                showError('Only DOCX files are supported.');
                return;
            }

            loading.classList.add('visible');

            const formData = new FormData();
            formData.append('file', file);

            fetch(`${API_BASE}/convert`, {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                loading.classList.remove('visible');

                if (data.error) {
                    showError(data.error);
                    return;
                }

                filename.textContent = data.filename;
                documentContent.innerHTML = data.html;
                uploadScreen.classList.add('hidden');
                viewer.classList.add('visible');
            })
            .catch(() => {
                loading.classList.remove('visible');
                showError('Failed to process document.');
            });
        }

        function closeViewer() {
            viewer.classList.remove('visible');
            uploadScreen.classList.remove('hidden');
            documentContent.innerHTML = '';
            fileInput.value = '';
            settingsPanel.classList.remove('visible');
        }

        function toggleDyslexia() {
            const btn = document.getElementById('dyslexiaBtn');
            documentContent.classList.toggle('dyslexia-font');
            btn.classList.toggle('active');
        }

        applyReadingAssistState();
        loadStoredDocument();
