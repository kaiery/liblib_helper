// ==UserScript==
// @name         liblib|civitai助手-封面+模型信息
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  liblib|civitai助手，下载封面+模型信息
// @author       kaiery
// @match        https://www.liblib.ai/modelinfo/*
// @match        https://www.liblib.art/modelinfo/*
// @match        https://civitai.com/models/*
// @match        https://civitai.red/models/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @license      MIT License
// @downloadURL https://update.greasyfork.org/scripts/508360/liblib%7Ccivitai%E5%8A%A9%E6%89%8B-%E5%B0%81%E9%9D%A2%2B%E6%A8%A1%E5%9E%8B%E4%BF%A1%E6%81%AF.user.js
// @updateURL https://update.greasyfork.org/scripts/508360/liblib%7Ccivitai%E5%8A%A9%E6%89%8B-%E5%B0%81%E9%9D%A2%2B%E6%A8%A1%E5%9E%8B%E4%BF%A1%E6%81%AF.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // 仅保留 liblib 流程仍在复用的少量全局状态，避免在多个辅助函数间层层传参。
    var model_name_ver;
    var textDesc, uuid, buildId, webid, modelId, modelName, modelVersionId;
    const default_download_pic_num = 100;
    // 封面选择模式：
    // - image：封面优先选图片；若无图片则兜底选第一个媒体
    // - video：封面优先选视频；若无视频则兜底选第一个图片，再兜底第一个媒体
    let coverSaveMode = 'image';
    // 是否下载 model_name_ver 子文件夹内的媒体图片（封面始终下载，不受该开关影响）
    let downloadImages = true;


    // 获取当前站点
    const currentSite = () => {
        if (window.location.hostname.includes('liblib')) {
            return 'liblib';
        } else if (window.location.hostname.includes('civitai')) {
            return 'civitai';
        } else {
            return 'unknown';
        }
    };

    const civitaiBaseUrl = () => {
        return window.location.hostname.includes('civitai.red') ? 'https://civitai.red' : 'https://civitai.com';
    };

    // ---------------------------------------------------------------
    // 下载相关工具函数（用于绕过 CORS、支持进度、支持 Range 分片等）
    // ---------------------------------------------------------------
    // 清洗 URL：从可能带反引号/空格的字符串中提取并规范化为可请求的 http(s) URL
    function normalizeUrl(url) {
        const rawUrl = String(url || '').trim();
        const extractedUrl = rawUrl.match(/https?:\/\/[^\s"'`<>]+/i)?.[0] ?? '';
        const cleanUrl = extractedUrl.replace(/[\u0060\u00B4\u2018\u2019\u201C\u201D\uFF40]/g, '').trim();
        if (!/^https?:\/\//i.test(cleanUrl)) {
            throw new Error(`invalid url: ${url}`);
        }
        return cleanUrl;
    }

    // 处理文件名中的非法字符，避免 Windows 写文件失败
    function sanitizeFilename(name) {
        let out = String(name || '');
        out = out.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        out = out.replace(/\s+/g, ' ').trim();
        out = out.replace(/[. ]+$/g, '');
        return out;
    }

    // 生成子文件夹内媒体文件名：优先使用 URL 末段文件名，取不到时用“fallbackBase + 时间戳”兜底
    function buildMediaFilenameFromUrl(url, fallbackBase, fallbackExt) {
        let cleanUrl;
        try {
            cleanUrl = normalizeUrl(url);
        } catch (_) {
            cleanUrl = '';
        }

        if (cleanUrl) {
            try {
                const u = new URL(cleanUrl);
                const lastSeg = u.pathname.split('/').filter(Boolean).pop() || '';
                const decoded = decodeURIComponent(lastSeg);
                const candidate = sanitizeFilename(decoded);
                if (candidate) {
                    if (candidate.includes('.')) {
                        return candidate;
                    }
                    const ext = sanitizeFilename(fallbackExt || '');
                    return ext ? `${candidate}.${ext}` : candidate;
                }
            } catch (_) {
            }
        }

        const base = sanitizeFilename(fallbackBase || 'file') || 'file';
        const ext = sanitizeFilename(fallbackExt || '');
        const ts = Date.now();
        return ext ? `${base}_${ts}.${ext}` : `${base}_${ts}`;
    }

    // 从 GM_xmlhttpRequest 的 responseHeaders 文本中提取指定 header（不区分大小写）
    function parseHeaderValue(responseHeaders, headerName) {
        const match = String(responseHeaders || '').match(new RegExp(`^\\s*${headerName}\\s*:\\s*([^\\r\\n;]+)`, 'im'));
        return match?.[1]?.trim() || '';
    }

    // 判断是否为视频扩展名（用于选择 Range 分片下载策略）
    function isVideoExt(ext) {
        return /^(mp4|webm|mov|m4v)$/i.test(String(ext || '').trim());
    }

    // 把按钮当作进度条：用背景渐变显示 0~100%，并在完成后恢复原样
    function createButtonProgressController(buttonEl) {
        if (!buttonEl) return null;
        const originalText = buttonEl.textContent || '';
        const originalStyle = buttonEl.getAttribute('style') || '';
        const originalDisabled = !!buttonEl.disabled;
        let targetPercent = 0;
        let targetText = originalText;
        let rafId = 0;

        const render = () => {
            rafId = 0;
            const pct = Math.max(0, Math.min(100, Math.round(Number(targetPercent) || 0)));
            const fill = '#4CAF50';
            const base = '#1E88E5';
            buttonEl.style.background = `linear-gradient(90deg, ${fill} ${pct}%, ${base} ${pct}%)`;
            buttonEl.textContent = `${targetText} ${pct}%`;
        };

        const scheduleRender = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(render);
        };

        const api = {
            start() {
                buttonEl.disabled = true;
                api.setProgress(0, originalText);
            },
            setProgress(percent, text) {
                targetPercent = percent;
                if (typeof text === 'string' && text.length > 0) {
                    targetText = text;
                }
                scheduleRender();
            },
            reset() {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = 0;
                if (originalStyle) buttonEl.setAttribute('style', originalStyle);
                else buttonEl.removeAttribute('style');
                buttonEl.textContent = originalText;
                buttonEl.disabled = originalDisabled;
            },
            resetAfter(ms) {
                const delay = Number(ms) || 0;
                if (delay <= 0) {
                    api.reset();
                    return;
                }
                setTimeout(() => api.reset(), delay);
            }
        };

        return api;
    }

    // 发起二进制请求的底层封装（返回 ArrayBuffer），可附带自定义 headers（如 Range）
    function gmRequestArrayBuffer(targetUrl, extraHeaders, timeoutMs) {
        const baseHeaders = {
            Referer: window.location.href,
            Accept: "*/*"
        };
        const headers = Object.assign(baseHeaders, extraHeaders || {});
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: targetUrl,
                headers,
                responseType: "arraybuffer",
                timeout: timeoutMs,
                withCredentials: true,
                anonymous: false,
                onload: (response) => resolve(response),
                onerror: (error) => reject(new Error(`GM_xmlhttpRequest failed for ${targetUrl}: ${JSON.stringify(error)}`)),
                ontimeout: () => reject(new Error(`GM_xmlhttpRequest timeout for ${targetUrl}`))
            });
        });
    }

    // 单次下载（适合图片）：支持 GM_xmlhttpRequest onprogress 获取 loaded/total，从而更新进度
    // 另外会尝试把 image.civitai.com 解析为最终跳转后的真实 CDN 地址再下载，提高成功率
    async function gmDownloadToFile(url, fileHandle, options) {
        const cleanUrl = normalizeUrl(url);
        let downloadUrl = cleanUrl;
        try {
            if (new URL(cleanUrl).hostname.includes('image.civitai.com') || new URL(cleanUrl).hostname.includes('civitai.red')) {
                const resp = await fetch(cleanUrl, { mode: 'no-cors', credentials: 'include', redirect: 'follow' });
                const redirectedUrl = resp?.url ? String(resp.url) : '';
                if (/^https?:\/\//i.test(redirectedUrl)) {
                    downloadUrl = normalizeUrl(redirectedUrl);
                }
            }
        } catch (_) {
        }

        const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
        const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 30000;

        const headersWithReferer = Object.assign({
            Referer: window.location.href,
            Accept: "*/*"
        }, options?.headers || {});
        const headersMinimal = Object.assign({
            Accept: "*/*"
        }, options?.headers || {});

        const writable = await fileHandle.createWritable();
        try {
            const requestOnce = (targetUrl, headers) => new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: targetUrl,
                    headers,
                    responseType: "arraybuffer",
                    timeout: timeoutMs,
                    withCredentials: true,
                    anonymous: false,
                    onprogress: (e) => {
                        if (!onProgress) return;
                        const loadedBytes = typeof e?.loaded === 'number' ? e.loaded : 0;
                        const totalBytes = typeof e?.total === 'number' ? e.total : null;
                        const percent = totalBytes ? Math.min(100, Math.floor((loadedBytes / totalBytes) * 100)) : 0;
                        onProgress({ loadedBytes, totalBytes, percent });
                    },
                    onload: (response) => resolve(response),
                    onerror: (error) => reject(new Error(`GM_xmlhttpRequest failed for ${targetUrl}: ${JSON.stringify(error)}`)),
                    ontimeout: () => reject(new Error(`GM_xmlhttpRequest timeout for ${targetUrl}`))
                });
            });

            let resp;
            try {
                resp = await requestOnce(downloadUrl, headersWithReferer);
            } catch (e1) {
                try {
                    resp = await requestOnce(downloadUrl, headersMinimal);
                } catch (_) {
                    throw e1;
                }
            }

            if (resp.status < 200 || resp.status >= 300) {
                throw new Error(`HTTP error! status: ${resp.status}`);
            }

            await writable.write(new Uint8Array(resp.response));
            if (onProgress) {
                onProgress({ loadedBytes: resp.response.byteLength, totalBytes: resp.response.byteLength, percent: 100 });
            }
        } finally {
            await writable.close();
        }
    }

    // Range 分片下载（适合视频/大文件）：按 chunkSize 循环请求 bytes=... 并顺序写入文件
    // - 支持重试
    // - 通过 Content-Range/Content-Length 推导总大小，计算整体进度
    // - 同样会尝试解析 image.civitai.com 的真实下载地址
    async function gmDownloadRangeToFile(url, fileHandle, options) {
        const cleanUrl = normalizeUrl(url);
        let downloadUrl = cleanUrl;
        try {
            if (new URL(cleanUrl).hostname.includes('image.civitai.com') || new URL(cleanUrl).hostname.includes('civitai.red')) {
                const resp = await fetch(cleanUrl, { mode: 'no-cors', credentials: 'include', redirect: 'follow' });
                const redirectedUrl = resp?.url ? String(resp.url) : '';
                if (/^https?:\/\//i.test(redirectedUrl)) {
                    downloadUrl = normalizeUrl(redirectedUrl);
                }
            }
        } catch (_) {
        }
        const chunkSize = options?.chunkSize ?? (4 * 1024 * 1024);
        const maxRetriesPerChunk = options?.maxRetriesPerChunk ?? 3;
        const baseDelayMs = options?.baseDelayMs ?? 600;
        const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;

        const writable = await fileHandle.createWritable();
        try {
            let totalSize = null;
            let offset = 0;

            let probeResp;
            try {
                probeResp = await gmRequestArrayBuffer(downloadUrl, { Range: "bytes=0-0" }, 30000);
            } catch (_) {
                probeResp = null;
            }

            if (probeResp && (probeResp.status === 206 || probeResp.status === 200)) {
                const contentRange = parseHeaderValue(probeResp.responseHeaders, 'content-range');
                if (contentRange) {
                    const m = contentRange.match(/\/(\d+)\s*$/);
                    if (m) totalSize = Number(m[1]);
                }
                if (!Number.isFinite(totalSize) || totalSize <= 0) {
                    const contentLength = parseHeaderValue(probeResp.responseHeaders, 'content-length');
                    if (contentLength) {
                        const n = Number(contentLength);
                        if (Number.isFinite(n) && n > 0 && probeResp.status === 200) {
                            totalSize = n;
                        }
                    }
                }

                if (probeResp.status === 200) {
                    await writable.write(new Uint8Array(probeResp.response));
                    if (onProgress) {
                        onProgress({ loadedBytes: probeResp.response.byteLength, totalBytes: probeResp.response.byteLength, percent: 100 });
                    }
                    return;
                }
            }

            while (totalSize === null || offset < totalSize) {
                const end = totalSize === null ? (offset + chunkSize - 1) : Math.min(offset + chunkSize - 1, totalSize - 1);
                const rangeValue = `bytes=${offset}-${end}`;

                let lastError = null;
                for (let attempt = 1; attempt <= maxRetriesPerChunk; attempt++) {
                    try {
                        const resp = await gmRequestArrayBuffer(downloadUrl, { Range: rangeValue }, 0);
                        if (resp.status === 206) {
                            await writable.write(new Uint8Array(resp.response));
                            offset += resp.response.byteLength;
                            if (totalSize === null) {
                                const contentRange = parseHeaderValue(resp.responseHeaders, 'content-range');
                                const m = contentRange.match(/\/(\d+)\s*$/);
                                if (m) totalSize = Number(m[1]);
                            }
                            if (onProgress) {
                                const percent = totalSize ? Math.min(100, Math.floor((offset / totalSize) * 100)) : 0;
                                onProgress({ loadedBytes: offset, totalBytes: totalSize, percent });
                            }
                            lastError = null;
                            break;
                        }
                        if (resp.status === 200 && offset === 0) {
                            await writable.write(new Uint8Array(resp.response));
                            if (onProgress) {
                                onProgress({ loadedBytes: resp.response.byteLength, totalBytes: resp.response.byteLength, percent: 100 });
                            }
                            return;
                        }
                        throw new Error(`unexpected status ${resp.status} for range ${rangeValue}`);
                    } catch (e) {
                        lastError = e;
                        if (attempt < maxRetriesPerChunk) {
                            await new Promise(r => setTimeout(r, baseDelayMs * attempt));
                        }
                    }
                }

                if (lastError) {
                    throw lastError;
                }

                if (totalSize !== null && offset >= totalSize) {
                    break;
                }
                if (totalSize === null && offset === 0) {
                    throw new Error('range download failed');
                }
            }
        } finally {
            await writable.close();
        }
    }

    // ---------------------------------------------------------------
    // html转文本
    // ---------------------------------------------------------------
    function htmlToText(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        let text = '';
        for (let i = 0; i < tempDiv.childNodes.length; i++) {
            if (tempDiv.childNodes[i].nodeName === 'P') {
                text += tempDiv.childNodes[i].textContent + '\n';
            }
        }
        return text;
    }

    // ---------------------------------------------------------------
    // 保存liblib封面信息
    // ---------------------------------------------------------------
    // liblib 页面导出入口：
    // 1. 读取当前激活版本和页面简介
    // 2. 请求模型接口
    // 3. 下载封面 / 附加图片
    // 4. 写入模型说明与示例 prompt
    async function saveLibLibAuthImagesInfo(buttonEl) {
        // 1:CheckPoint 2:embedding；3：HYPERNETWORK ；4：AESTHETIC GRADIENT; 5：Lora；6：LyCORIS;  9:WILDCARDS
        let modelType = 1;

        const buttonProgress = createButtonProgressController(buttonEl);
        if (buttonProgress) buttonProgress.start();

        try {
        // open directory picker
        const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });

        // 根据选项卡获取模型版本id
        const div = document.querySelector('.ant-tabs-tab.ant-tabs-tab-active');
        const modelVersionId = parseInt(div.getAttribute('data-node-key'));
        const modelVer = div.innerText.replace(/[/\\?%*:|"<>~]/g, '-');

        const allElements = document.querySelectorAll('div');
        allElements.forEach(function (element) {
            const classNames = element.className.split(/\s+/);
            for (let i = 0; i < classNames.length; i++) {
                if (classNames[i].startsWith('ModelDescription_desc')) {
                    textDesc = htmlToText(element.innerHTML);
                    textDesc = textDesc.replace(/\\n/g, '\n');
                    break;
                }
            }
        });
        if (textDesc) {
            const scriptContent = document.getElementById('__NEXT_DATA__').textContent;
            const scriptJson = JSON.parse(scriptContent);

            // Extract uuid, buildId, and webid
            uuid = scriptJson.query.uuid;
            buildId = scriptJson.buildId;
            webid = scriptJson.props.webid;
            //------------
            // 预请求地址
            const url_acceptor = "https://www.liblib.art/api/www/log/acceptor/f?timestamp=" + Date.now();
            // 模型信息地址
            const url_model = "https://www.liblib.art/api/www/model/getByUuid/" + uuid + "?timestamp=" + Date.now();


            // 发送预请求-------------------------------------------------------
            const resp_acc = await fetch(url_acceptor, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ timestamp: Date.now() })
            })

            // 发送模型信息
            const resp = await fetch(url_model, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ timestamp: Date.now() })
            })

            const model_data = await resp.json();
            if (model_data.code !== 0) {
                return;
            }

            modelId = model_data.data.id
            modelName = model_data.data.name.replace(/[/\\?%*:|"<>~]/g, '-');

            model_name_ver = modelName + "_" + modelVer;
            if (model_name_ver.slice(-1) === '.') {
                model_name_ver = model_name_ver.substring(0, model_name_ver.length - 1);
            }
            modelType = model_data.data.modelType // 1:CheckPoint 2:embedding；3：HYPERNETWORK ；4：AESTHETIC GRADIENT; 5：Lora；6：LyCORIS;  9:WILDCARDS

            let modelTypeName = '未分类'
            switch (modelType) {
                case 1:
                    modelTypeName = 'CheckPoint'
                    break;
                case 2:
                    modelTypeName = 'embedding'
                    break;
                case 3:
                    modelTypeName = 'HYPERNETWORK'
                    break;
                case 4:
                    modelTypeName = 'AESTHETIC GRADIENT'
                    break;
                case 5:
                    modelTypeName = 'Lora'
                    break;
                case 6:
                    modelTypeName = 'LyCORIS'
                    break;
                case 9:
                    modelTypeName = 'WILDCARDS'
                    break;
            }

            const versions = model_data.data.versions;
            for (const verItem of versions) {
                // 匹配版本号
                if (verItem.id === modelVersionId) {

                    // 模型信息json信息
                    let modelInfoJson = {
                        modelType: modelTypeName,
                        description: textDesc,
                        uuid: uuid,
                        buildId: buildId,
                        webid: webid
                    };

                    const promptList = []
                    // 图片信息start
                    const authImages = verItem.imageGroup.images;
                    const modelDirHandle = await dirHandle.getDirectoryHandle(model_name_ver, { create: true });

                    const mediaCandidates = authImages.filter(item => item && item.imageUrl);
                    const coverItem = mediaCandidates[0] ?? null;
                    const additionalMediaCandidates = downloadImages
                        ? mediaCandidates.filter(item => item && item !== coverItem).slice(0, default_download_pic_num)
                        : [];

                    const totalUnits = (coverItem ? 1 : 0) + additionalMediaCandidates.length + 2;
                    let completedUnits = 0;
                    const setOverallProgress = (unitProgress, text) => {
                        if (!buttonProgress) return;
                        const p = Math.max(0, Math.min(1, Number(unitProgress) || 0));
                        const overall = totalUnits > 0 ? ((completedUnits + p) / totalUnits) * 100 : 0;
                        buttonProgress.setProgress(overall, text || '处理中');
                    };

                    const downloadOne = async (mediaUrl, ext, fileHandle, unitLabel) => {
                        if (isVideoExt(ext)) {
                            await gmDownloadRangeToFile(mediaUrl, fileHandle, {
                                onProgress: (p) => setOverallProgress((Number(p?.percent) || 0) / 100, unitLabel)
                            });
                            setOverallProgress(1, unitLabel);
                            return;
                        }
                        try {
                            await gmDownloadToFile(mediaUrl, fileHandle, {
                                onProgress: (p) => setOverallProgress((Number(p?.percent) || 0) / 100, unitLabel)
                            });
                        } catch (_) {
                            await gmDownloadRangeToFile(mediaUrl, fileHandle, {
                                chunkSize: 1024 * 1024,
                                maxRetriesPerChunk: 5,
                                onProgress: (p) => setOverallProgress((Number(p?.percent) || 0) / 100, unitLabel)
                            });
                        }
                        setOverallProgress(1, unitLabel);
                    };

                    for (const authImage of authImages) {
                        const generateInfo = authImage.generateInfo;
                        if (generateInfo) {
                            if (generateInfo.prompt) {
                                promptList.push(generateInfo.prompt)
                            }
                        }
                    }

                    if (coverItem) {
                        const coverUrl = coverItem.imageUrl;
                        let coverExt = coverUrl.split("/").pop().split(".").pop();
                        const tmp = coverExt.indexOf("?");
                        if (tmp > 0) {
                            coverExt = coverExt.substring(0, tmp);
                        }
                        try {
                            const unitLabel = `下载 ${completedUnits + 1}/${totalUnits}`;
                            setOverallProgress(0, unitLabel);
                            const fileName = model_name_ver + "." + coverExt;
                            const picHandle = await dirHandle.getFileHandle(fileName, { create: true });
                            await downloadOne(coverUrl, coverExt, picHandle, unitLabel);
                            completedUnits += 1;
                            console.log("Image written to file:", fileName);
                        } catch (error) {
                            console.error(`[封面下载失败][liblib] ${coverUrl}`, error);
                            completedUnits += 1;
                            setOverallProgress(0, `下载 ${completedUnits}/${totalUnits}`);
                        }
                    }

                    if (additionalMediaCandidates.length > 0) {
                        let i = 0;
                        for (const item of additionalMediaCandidates) {
                            i += 1;
                            const mediaUrl = item.imageUrl;
                            let mediaExt = mediaUrl.split("/").pop().split(".").pop();
                            const tmp = mediaExt.indexOf("?");
                            if (tmp > 0) {
                                mediaExt = mediaExt.substring(0, tmp);
                            }
                            const unitLabel = `下载 ${completedUnits + 1}/${totalUnits}`;
                            try {
                                setOverallProgress(0, unitLabel);
                                const desiredName = buildMediaFilenameFromUrl(mediaUrl, `${model_name_ver}_${Date.now()}_${i}`, mediaExt);
                                const fileHandle = await modelDirHandle.getFileHandle(desiredName, { create: true });
                                await downloadOne(mediaUrl, mediaExt, fileHandle, unitLabel);
                                console.log("Image written to file:", desiredName);
                            } catch (error) {
                                console.error(`[媒体下载失败][liblib] ${mediaUrl}`, error);
                            } finally {
                                completedUnits += 1;
                            }
                        }
                    }
                    // 图片信息end


                    let triggerWord = '触发词：';
                    if ('triggerWord' in verItem && verItem.triggerWord) {
                        triggerWord = triggerWord + verItem.triggerWord
                    } else {
                        triggerWord = triggerWord + "无";
                    }
                    modelInfoJson.triggerWord = triggerWord

                    // 创建模型目录( 模型+版本名 )
                    // 获取文件句柄
                    const savejsonHandle = await modelDirHandle.getFileHandle(modelName + ".txt", { create: true });
                    // 写入模型信息json文件
                    const writablejson = await savejsonHandle.createWritable();
                    setOverallProgress(0, `写入 ${completedUnits + 1}/${totalUnits}`);
                    // 将 modelInfoJson 的每个字段转成单独一行文本
                    const lines = [];
                    for (const [key, value] of Object.entries(modelInfoJson)) {
                        lines.push(`${key}: ${value}`);
                    }
                    const modelInfoText = lines.join('\n');
                    await writablejson.write(modelInfoText);
                    await writablejson.close();
                    completedUnits += 1;
                    setOverallProgress(1, `写入 ${completedUnits}/${totalUnits}`);

                    // 获取文件句柄
                    const saveExampleHandle = await modelDirHandle.getFileHandle("example.txt", { create: true });
                    const writableExample = await saveExampleHandle.createWritable();
                    setOverallProgress(0, `写入 ${completedUnits + 1}/${totalUnits}`);
                    await writableExample.write(triggerWord + '\n\n');
                    // 写入字符串数组
                    for (const str of promptList) {
                        await writableExample.write(str + '\n\n');
                    }
                    await writableExample.close();
                    completedUnits += 1;
                    setOverallProgress(1, `写入 ${completedUnits}/${totalUnits}`);
                }
            }
        }
        alert("封面信息下载完成");
        } finally {
            if (buttonProgress) buttonProgress.resetAfter(800);
        }
    }

    // ---------------------------------------------------------------
    // 保存封面信息
    // ---------------------------------------------------------------
    // Civitai 页面导出入口：
    // 1. 先从当前页面识别 modelId / modelVersionId
    // 2. 再请求模型接口拿到完整版本数据
    // 3. 同时结合页面右侧当前展示文案，补足接口里缺失的“关于此版本”
    // 4. 下载封面、附加图片，并导出说明与示例 prompt
    async function saveCivitaiModelInfo(buttonEl) {
        // 模型id
        let modelId = 0;
        // 模型版本id
        let modelVersionId = 0;
        // 模型描述
        let textDesc = '';
        // 模型名称
        let modelName = '';
        // 模型版本
        let modelVer = '';
        // 样图提示词举例
        let example = []

        const buttonProgress = createButtonProgressController(buttonEl);
        if (buttonProgress) buttonProgress.start();

        try {
        // open directory picker
        const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });


        // modelId 以 URL 为准；modelVersionId 优先取当前页面展示版本，再由接口结果兜底
        const idsFromPage = getCivitaiIdsFromPage();
        if (idsFromPage.modelId) {
            modelId = idsFromPage.modelId;
            modelVersionId = idsFromPage.modelVersionId || '';

            // 接口url
            const url_model = civitaiBaseUrl() + "/api/v1/models/" + modelId;

            // 发送模型信息
            const resp = await fetch(url_model, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ timestamp: Date.now() })
            })
            if (!resp.ok) {
                console.log(`HTTP error! status: ${resp.status}`);
                alert(`[错误：访问模型信息接口失败] ${resp.status}`);
                return;
            }
            const model_data = await resp.json();
            // 检查 data 是否为空
            if (!model_data) {
                console.log(`模型信息为空 *************************************************************`);
                // alert(`模型信息为空`);
                return;
            }

            //检查 data 是否包含 error 和 message
            if (model_data.message && model_data.error) {
                console.log(`数据为空 *************************************************************`);
                // alert(`数据为空`);
                return;
            }
            modelName = model_data.name.replace(/[/\\?%*:|"<>~]/g, '-');

            let modelType = model_data.modelType // 1:CheckPoint 2:embedding；3：HYPERNETWORK ；4：AESTHETIC GRADIENT; 5：Lora；6：LyCORIS;  9:WILDCARDS
            let modelTypeName = '未分类'
            switch (modelType) {
                case 1:
                    modelTypeName = 'CheckPoint'
                    break;
                case 2:
                    modelTypeName = 'embedding'
                    break;
                case 3:
                    modelTypeName = 'HYPERNETWORK'
                    break;
                case 4:
                    modelTypeName = 'AESTHETIC GRADIENT'
                    break;
                case 5:
                    modelTypeName = 'Lora'
                    break;
                case 6:
                    modelTypeName = 'LyCORIS'
                    break;
                case 9:
                    modelTypeName = 'WILDCARDS'
                    break;
            }
            if (modelTypeName === '未分类') {
                if ('type' in model_data) {
                    modelTypeName = model_data.type
                }
            }
            // 模型版本数组
            let versions = model_data.modelVersions;

            if (!modelVersionId) {
                const idsFromDomRetry = getCivitaiIdsFromPage();
                if (idsFromDomRetry.modelVersionId) {
                    modelVersionId = idsFromDomRetry.modelVersionId;
                } else if (versions.length === 1 && versions[0]?.id) {
                    modelVersionId = String(versions[0].id);
                }
            }

            if (!modelVersionId) {
                alert("未能识别当前模型版本ID");
                return;
            }

            for (const verItem of versions) {
                // 匹配版本号
                if (verItem.id.toString() === modelVersionId) {
                    modelVer = verItem.name;
                    model_name_ver = modelName + "_" + modelVer;
                    if (model_name_ver.slice(-1) === '.') {
                        model_name_ver = model_name_ver.substring(0, model_name_ver.length - 1);
                    }
                    let files = verItem.files;
                    let modelFile = '';
                    let split = '';
                    if (files.length === 1) {
                        modelFile = files[0].name;
                        split = splitFilename(modelFile);
                        model_name_ver = split.name.trimEnd();
                    } else {
                        // 弹出选择模型文件框---------------------
                        const selectedObject = await showObjectSelectionDialog(files);
                        if (!selectedObject) {
                            return;
                        }
                        modelFile = selectedObject.name;
                        split = splitFilename(modelFile);
                        model_name_ver = split.name;
                    }

                    // 模型介绍：优先保留页面右侧 "About this version" 的当前展示文本，接口内容作为兜底
                    const aboutThisVersionText = extractCivitaiAboutThisVersionText();
                    const pageModelDescription = normalizeMultilineText(extractCivitaiTextFromSecondSpoiler() || '');
                    const versionDescription = normalizeMultilineText(aboutThisVersionText || htmlToPlainTextFormatted(verItem.description || ''));
                    const modelDescription = normalizeMultilineText(pageModelDescription || htmlToPlainTextFormatted(model_data.description || ''));
                    textDesc = ' \n\n-----关于此版本------\n\n'
                        + (versionDescription || '无')
                        + '\n\n-----模型介绍------\n\n'
                        + (modelDescription || '无')
                        + '\n\n-----其他参数------\n\n';
                    // 模型信息
                    let modelInfoJson = {
                        modelType: modelTypeName,
                        description: textDesc,
                        modelName: modelName,
                        modelVer: modelVer,
                        modelId: modelId,
                        modelFile: modelFile,
                        modelVersionId: modelVersionId
                    };
                    // 提示词列表
                    const promptList = []

                    // 图片与视频元数据：接口里包含当前版本的全部媒体资源
                    let authImages = verItem.images;

                    authImages = authImages.filter(item => item && (item.type === 'image' || item.type === 'video'));

                    let images = [];
                    for (const img of authImages) {
                        if (img.type === 'image' || img.type === 'video') {
                            images.push(img);
                        }
                    }
                    // 获取样图id数组-------------------
                    const imageIds = getImageIds(images); // 直接调用，getImageIds 应该是同步的
                    if (imageIds.length > 0) {
                        // 获取样图信息
                        example = await getImageExample(imageIds);
                        if (example.length > 0) {
                            example.forEach(item => {
                                let itemType = item?.result?.data?.json?.type ?? undefined;
                                let meta = item?.result?.data?.json?.meta ?? undefined;
                                if (meta !== undefined && (itemType === 'image' || itemType === 'video')) {
                                    const promptMeta = {
                                        prompt: meta.prompt,
                                        negativePrompt: meta.negativePrompt,
                                        sampler: meta.sampler,
                                        cfgScale: meta.cfgScale,
                                        steps: meta.steps,
                                        Size: meta.Size
                                    };
                                    promptList.push(promptMeta);
                                }
                            });
                        }
                    }

                    // 统一写入子文件夹：model_name_ver
                    const modelDirHandle = await dirHandle.getDirectoryHandle(model_name_ver, { create: true });

                    // mediaCandidates：该版本下的媒体（图片/视频）
                    const mediaCandidates = authImages.filter(item => item && item.url);

                    // 选择封面：由 coverSaveMode 控制，但始终保证“至少选到一个可用媒体”作为兜底
                    const coverImageCandidates = mediaCandidates.filter(item => item.type === 'image');
                    const coverVideoCandidate = mediaCandidates.find(item => item.type === 'video') ?? null;
                    const coverImageCandidate = coverImageCandidates[0] ?? null;
                    const coverItem = coverSaveMode === 'video'
                        ? (coverVideoCandidate ?? coverImageCandidate ?? (mediaCandidates[0] ?? null))
                        : (coverImageCandidate ?? (mediaCandidates[0] ?? null));

                    // 是否下载子文件夹内的图片：downloadImages 仅控制 additionalMediaCandidates，不影响封面下载
                    const additionalMediaCandidates = downloadImages
                        ? mediaCandidates.filter(item => item && item.type === 'image' && item !== coverItem).slice(0, default_download_pic_num)
                        : [];

                    // 总进度单位：封面（1）+ 子文件夹内图片（N）+ 两个文本文件（2）
                    const totalUnits = (coverItem ? 1 : 0) + additionalMediaCandidates.length + 2;
                    let completedUnits = 0;
                    const setOverallProgress = (unitProgress, text) => {
                        if (!buttonProgress) return;
                        const p = Math.max(0, Math.min(1, Number(unitProgress) || 0));
                        const overall = totalUnits > 0 ? ((completedUnits + p) / totalUnits) * 100 : 0;
                        buttonProgress.setProgress(overall, text || '处理中');
                    };

                    // 单个文件下载：图片走单次下载（支持 onprogress）；视频走 Range 分片下载（更稳）
                    const downloadOne = async (mediaUrl, ext, fileHandle, unitLabel) => {
                        if (isVideoExt(ext)) {
                            await gmDownloadRangeToFile(mediaUrl, fileHandle, {
                                onProgress: (p) => setOverallProgress((Number(p?.percent) || 0) / 100, unitLabel)
                            });
                            setOverallProgress(1, unitLabel);
                            return;
                        }
                        try {
                            await gmDownloadToFile(mediaUrl, fileHandle, {
                                onProgress: (p) => setOverallProgress((Number(p?.percent) || 0) / 100, unitLabel)
                            });
                        } catch (_) {
                            await gmDownloadRangeToFile(mediaUrl, fileHandle, {
                                chunkSize: 1024 * 1024,
                                maxRetriesPerChunk: 5,
                                onProgress: (p) => setOverallProgress((Number(p?.percent) || 0) / 100, unitLabel)
                            });
                        }
                        setOverallProgress(1, unitLabel);
                    };

                    // 封面选择策略由全局变量 coverSaveMode 控制
                    if (coverItem) {
                        const coverUrl = coverItem.url;
                        let coverExt = coverUrl.split("/").pop().split(".").pop();
                        const tmp = coverExt.indexOf("?");
                        if (tmp > 0) {
                            coverExt = coverExt.substring(0, tmp);
                        }
                        try {
                            const unitLabel = `下载 ${completedUnits + 1}/${totalUnits}`;
                            setOverallProgress(0, unitLabel);
                            const fileName = model_name_ver + "." + coverExt;
                            const picHandle = await dirHandle.getFileHandle(fileName, { create: true });
                            await downloadOne(coverUrl, coverExt, picHandle, unitLabel);
                            completedUnits += 1;
                            console.log("Image written to file:", fileName);
                        } catch (error) {
                            console.error(`[封面下载失败][civitai] ${coverUrl}`, error);
                            completedUnits += 1;
                            setOverallProgress(0, `下载 ${completedUnits}/${totalUnits}`);
                        }
                    }

                    if (additionalMediaCandidates.length > 0) {
                        let i = 0;
                        for (const item of additionalMediaCandidates) {
                            i += 1;
                            const mediaUrl = item.url;
                            let mediaExt = mediaUrl.split("/").pop().split(".").pop();
                            const tmp = mediaExt.indexOf("?");
                            if (tmp > 0) {
                                mediaExt = mediaExt.substring(0, tmp);
                            }
                            const unitLabel = `下载 ${completedUnits + 1}/${totalUnits}`;
                            try {
                                setOverallProgress(0, unitLabel);
                                // 子文件夹内媒体文件：优先用 URL 文件名，重复则覆盖；取不到时兜底“目录名+时间戳”
                                const desiredName = buildMediaFilenameFromUrl(mediaUrl, `${model_name_ver}_${Date.now()}_${i}`, mediaExt);
                                const fileHandle = await modelDirHandle.getFileHandle(desiredName, { create: true });
                                await downloadOne(mediaUrl, mediaExt, fileHandle, unitLabel);
                                console.log("Image written to file:", desiredName);
                            } catch (error) {
                                console.error(`[媒体下载失败][civitai] ${mediaUrl}`, error);
                            } finally {
                                completedUnits += 1;
                            }
                        }
                    }

                    let triggerWord = '触发词：';
                    if ('trainedWords' in verItem && verItem.trainedWords) {
                        triggerWord = triggerWord + verItem.trainedWords
                    } else {
                        triggerWord = triggerWord + "无";
                    }
                    modelInfoJson.triggerWord = triggerWord

                    // 获取文件句柄
                    const savejsonHandle = await modelDirHandle.getFileHandle(modelName + ".txt", { create: true });
                    // 写入模型信息json文件
                    const writablejson = await savejsonHandle.createWritable();
                    setOverallProgress(0, `写入 ${completedUnits + 1}/${totalUnits}`);
                    await writablejson.write(flattenObjectToPlainTextWithHtmlHandling(modelInfoJson));
                    await writablejson.close();
                    completedUnits += 1;
                    setOverallProgress(1, `写入 ${completedUnits}/${totalUnits}`);

                    // 获取文件句柄
                    const saveExampleHandle = await modelDirHandle.getFileHandle("example.txt", { create: true });
                    const writableExample = await saveExampleHandle.createWritable();
                    setOverallProgress(0, `写入 ${completedUnits + 1}/${totalUnits}`);
                    await writableExample.write(triggerWord + '\n\n');
                    // 写入字符串数组
                    for (const str of promptList) {
                        await writableExample.write(JSON.stringify(str, null, 4) + '\n\n');
                    }
                    await writableExample.close();
                    completedUnits += 1;
                    setOverallProgress(1, `写入 ${completedUnits}/${totalUnits}`);

                } // 匹配版本end
            } // 循环versions


            alert("封面信息下载完成");

        } else {
            alert("未找到模型ID信息");
        }
        } finally {
            if (buttonProgress) buttonProgress.resetAfter(800);
        }
    }

    /**
     * 将HTML字符串转换为格式化的纯文本。
     * - <p> 标签转换为两个换行符。
     * - <br> 标签转换为一个换行符。
     * - 移除所有其他HTML标签，并清理多余的空白和换行。
     * @param {string} htmlString 包含HTML的字符串
     * @returns {string} 格式化的纯文本
     */
    function htmlToPlainTextFormatted(htmlString) {
        if (typeof htmlString !== 'string' || !htmlString.includes('<')) {
            // 如果不是字符串或者不包含HTML标签，直接返回
            return String(htmlString);
        }

        // 检查是否在浏览器环境中（有DOMParser）
        if (typeof DOMParser !== 'undefined') {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');
            const tempDiv = doc.body; // 使用body作为容器

            // 1. 处理 <br> 标签：替换为换行符
            tempDiv.querySelectorAll('br').forEach(br => {
                const textNode = doc.createTextNode('\n');
                br.replaceWith(textNode);
            });

            // 2. 处理块级元素（如 <p>, <div>, <h1>-<h6>, <ul>, <ol>, <li>）：
            //    将它们的内容提取出来，并在末尾添加一个或两个换行符。
            //    这里使用一个更通用的策略：在块级元素前后插入特殊标记，然后提取textContent再替换标记。
            //    或者更直接的方法：迭代，替换元素为它的文本内容 + 换行。
            const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li'];
            blockTags.forEach(tag => {
                tempDiv.querySelectorAll(tag).forEach(el => {
                    // 如果是 p 标签，添加双倍换行以模拟段落间距
                    const newlines = (tag === 'p') ? '\n\n' : '\n';
                    // 创建一个包含元素文本内容和换行符的新文本节点
                    const textNode = doc.createTextNode((el.textContent || '') + newlines);
                    // 将原始元素替换为新创建的文本节点
                    el.replaceWith(textNode);
                });
            });

            // 3. 获取最终的文本内容（此时所有标签应该都已被处理或移除）
            let plainText = tempDiv.textContent || '';

            // 4. 清理多余的空白和换行
            // 压缩多个连续的换行符到最多两个 (模拟段落间距)
            plainText = plainText.replace(/(\n){3,}/g, '\n\n');
            // 移除行首尾的空白字符
            plainText = plainText.replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '');
            // 移除连续的空白（非换行）
            plainText = plainText.replace(/[ \t]+/g, ' ');
            // 移除字符串开头和结尾的空白
            plainText = plainText.trim();

            return plainText;
        } else {
            // Node.js 环境或不支持 DOMParser 的环境，提供一个简化的正则回退方案。
            // 注意：这种正则方案非常简陋，不推荐用于复杂的HTML。
            console.warn("Warning: DOMParser not available. Using simplified regex for HTML to plain text conversion. This may not handle complex HTML correctly.");
            let text = htmlString
                .replace(/<br\s*\/?>/gi, '\n')      // <br> becomes newline
                .replace(/<p\s*[^>]*>/gi, '\n\n')  // <p> becomes two newlines
                .replace(/<\/p>/gi, '')           // </p> removed
                .replace(/<[^>]*>/g, '');          // Strip all remaining HTML tags
            return text.replace(/\n{3,}/g, '\n\n').trim(); // Consolidate multiple newlines
        }
    }

    function normalizeMultilineText(text) {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function extractCivitaiSectionTextByHeading(headingTexts) {
        // 直接按右侧卡片标题定位，优先保留页面真实展示出来的版本说明内容。
        const targets = Array.isArray(headingTexts) ? headingTexts : [headingTexts];
        const normalizedTargets = targets.map((item) => getTextContentNormalized(item).toLowerCase()).filter(Boolean);
        if (normalizedTargets.length === 0) {
            return '';
        }

        const headingElement = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4'))
            .find((element) => {
                const text = getTextContentNormalized(element).toLowerCase();
                return normalizedTargets.includes(text);
            });

        const card = headingElement?.closest('[data-with-border="true"]');
        if (!card) {
            return '';
        }

        const clone = card.cloneNode(true);
        clone.querySelectorAll('[data-first-section="true"]').forEach((element) => element.remove());
        clone.querySelectorAll('button').forEach((button) => {
            const text = getTextContentNormalized(button).toLowerCase();
            if (text === 'show more' || text === 'show less') {
                button.remove();
            }
        });

        let text = htmlToPlainTextFormatted(clone.innerHTML);
        normalizedTargets.forEach((target) => {
            const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp(`^${escaped}\\s*`, 'i'), '');
        });
        return normalizeMultilineText(text);
    }


    /**
     * 将JavaScript对象展开成纯文本，每个字段为一行，包含key和value。
     * 如果值是包含HTML的字符串，则将其转换为格式化的纯文本。
     * @param {Object} obj 要展开的对象
     * @param {string} separator key和value之间的分隔符，默认为": "
     * @returns {string} 展开后的纯文本字符串
     */
    function flattenObjectToPlainTextWithHtmlHandling(obj, separator = ": ") {
        if (typeof obj !== 'object' || obj === null) {
            return String(obj);
        }

        const lines = Object.entries(obj).map(([key, value]) => {
            let formattedValue;
            if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
                // 如果是字符串且可能包含HTML，则进行HTML到纯文本的转换
                formattedValue = htmlToPlainTextFormatted(value);
            } else if (typeof value === 'object' && value !== null) {
                // 对于嵌套对象，可以使用 JSON.stringify 进行格式化
                formattedValue = JSON.stringify(value, null, 2);
            } else {
                formattedValue = value;
            }
            return `${key}${separator}${formattedValue}`;
        });

        return lines.join('\n');
    }


    // 保留旧函数名，兼容原有调用点。
    // 新版页面结构不稳定，因此这里会优先取第 2 个 spoiler，取不到再回退第 1 个。
    function extractCivitaiTextFromSecondSpoiler() {
        const spoilerElements = document.querySelectorAll('.mantine-Spoiler-content');
        if (spoilerElements.length === 0) {
            console.warn("未找到 .mantine-Spoiler-content 元素");
            return null;
        }

        const candidates = [spoilerElements[1], spoilerElements[0]].filter(Boolean);
        for (const element of candidates) {
            const text = normalizeMultilineText(extractCivitaiText(element));
            if (text) {
                return text;
            }
        }

        return null;
    }

    function extractCivitaiText(element) {
        let text = '';
        // 递归遍历所有子节点
        for (let i = 0; i < element.childNodes.length; i++) {
            const node = element.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent.trim(); // 添加文本节点的内容，去除前后空格
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName.toLowerCase() === 'p') {
                    text += '\n'; // 替换 <p> 标签为换行符
                }
                text += extractCivitaiText(node); // 递归调用处理子元素
            }
        }
        return text;
    }

    function extractCivitaiAboutThisVersionText() {
        return extractCivitaiSectionTextByHeading(['About this version']);
    }

    // 获取图像 ID 数组
    function getImageIds(images) {
        const imageIds = [];
        for (const image of images) {
            const url = image.url;
            const A = url.split('/').pop(); // 使用 pop() 更简洁地获取最后一个元素
            const imgId = A.split('.')[0];
            imageIds.push(imgId);
            console.log(`imgId: ${imgId}`);
        }
        return imageIds;
    }

    // 获取示例图像数组
    async function getImageExample(imageIds) {
        const exampleList = [];
        if (imageIds.length > 0) {
            for (const imageId of imageIds) {
                const inputObject = { json: { id: parseInt(imageId, 10), authed: true } }; // 确保 imageId 是数字
                const encodedImageId = encodeURIComponent(JSON.stringify(inputObject));
                const url = `${civitaiBaseUrl()}/api/trpc/image.getGenerationData?input=${encodedImageId}`;

                try {
                    console.log('request image info url ');
                    const response = await fetch(url);
                    if (!response.ok) {
                        alert(`HTTP error! status: ${response.status}`);
                        console.log(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    exampleList.push(data);
                } catch (error) {
                    console.error(`[错误：访问模型信息接口失败] [url：${url}] [异常：${error}]`);
                    alert(`[错误：访问模型信息接口失败] [url：${url}] [异常：${error}]`);
                }
            }
        }
        return exampleList;
    }

    function createSimpleModal(options) {
        return new Promise((resolve, reject) => {
            const modal = document.createElement('div');
            modal.style.position = 'fixed';
            modal.style.top = '50%';
            modal.style.left = '50%';
            modal.style.transform = 'translate(-50%, -50%)';
            modal.style.backgroundColor = '#fff';
            modal.style.border = '1px solid #ccc';
            modal.style.padding = '20px';
            modal.style.zIndex = '1000';
            modal.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
            modal.style.borderRadius = '5px';
            modal.style.fontFamily = 'Arial, sans-serif';

            const title = document.createElement('h3');
            title.textContent = options.title || '请选择一个对象';
            modal.appendChild(title);

            const form = document.createElement('form');
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                const selectedValue = document.querySelector('input[name="objectOption"]:checked')?.value;

                if (!selectedValue) {
                    // 显示提示信息
                    alert('请选择一个选项！');
                    return; // 阻止模态框关闭和 Promise resolve
                }

                modal.remove();
                resolve(selectedValue); // Resolve Promise with selected name
            });

            options.items.forEach(item => {
                const radioLabel = document.createElement('label');
                radioLabel.style.display = 'block';
                radioLabel.style.marginBottom = '5px';
                const radioInput = document.createElement('input');
                radioInput.type = 'radio';
                radioInput.name = 'objectOption';
                radioInput.value = item.name;
                radioLabel.appendChild(radioInput);
                radioLabel.appendChild(document.createTextNode(`${item.name} (${item.sizeKB} KB)`));
                form.appendChild(radioLabel);
            });

            const submitButton = document.createElement('button');
            submitButton.type = 'submit';
            submitButton.textContent = '提交';
            submitButton.style.marginTop = '10px';
            submitButton.style.padding = '8px 12px';
            submitButton.style.backgroundColor = '#4CAF50';
            submitButton.style.color = 'white';
            submitButton.style.border = 'none';
            submitButton.style.borderRadius = '4px';
            submitButton.style.cursor = 'pointer';
            form.appendChild(submitButton);

            modal.appendChild(form);
            document.body.appendChild(modal);

            // 添加关闭按钮，点击后提示选择
            const closeButton = document.createElement('button');
            closeButton.textContent = '关闭';
            closeButton.style.marginTop = '10px';
            closeButton.style.padding = '8px 12px';
            closeButton.style.backgroundColor = '#ccc';
            closeButton.style.color = 'white';
            closeButton.style.border = 'none';
            closeButton.style.borderRadius = '4px';
            closeButton.style.cursor = 'pointer';
            closeButton.addEventListener('click', () => {
                alert('请选择一个选项！');
            });
            modal.appendChild(closeButton);
        });
    }

    async function showObjectSelectionDialog(objects) {
        const selectedName = await createSimpleModal({
            title: '选择要提交的对象',
            items: objects
        });

        if (selectedName) {
            const selectedObject = objects.find(obj => obj.name === selectedName);
            return selectedObject; // Return selected object
        } else {
            return null; // Return null if no object selected
        }
    }
    function splitFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return { name: '', extension: null }; // 处理空字符串或无效输入
        }

        const lastDotIndex = filename.lastIndexOf('.');

        if (lastDotIndex === -1) {
            return { name: filename, extension: null }; // 没有扩展名
        }

        const name = filename.substring(0, lastDotIndex);
        const extension = filename.substring(lastDotIndex + 1);

        return { name: name, extension: extension };
    }

    const helperPanelId = 'kaiery-liblib-helper-panel';
    const liblibPlaceholderId = 'kaiery-liblib-helper-placeholder';

    function getTextContentNormalized(element) {
        return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function ensurePanelInteractive(panelEl) {
        if (!panelEl) {
            return;
        }

        panelEl.style.display = 'flex';
        panelEl.style.zIndex = '2147483647';
        panelEl.style.pointerEvents = 'auto';
        panelEl.style.isolation = 'isolate';

        const parent = panelEl.parentElement;
        if (parent) {
            if (!parent.style.position) {
                parent.style.position = 'relative';
            }
            parent.style.pointerEvents = 'auto';
        }

        panelEl.querySelectorAll('button, input, label').forEach((element) => {
            element.style.pointerEvents = 'auto';
        });
    }

    function findLibLibActionCard() {
        return document.querySelector('[class^="ModelActionCard_modelActionCard"]');
    }

    function ensureLibLibPlaceholder(panelEl) {
        const actionCard = findLibLibActionCard();
        if (!actionCard?.parentElement || !panelEl) {
            return null;
        }

        let placeholder = document.getElementById(liblibPlaceholderId);
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = liblibPlaceholderId;
            placeholder.dataset.helperPlaceholder = 'liblib';
        }

        // 占位块仍插在右栏原位置，保持页面布局；真正可点击的面板则挂在 body 下。
        if (placeholder.parentElement !== actionCard.parentElement || placeholder.nextElementSibling !== actionCard) {
            actionCard.parentElement.insertBefore(placeholder, actionCard);
        }

        const actionRect = actionCard.getBoundingClientRect();
        const width = Math.max(220, Math.round(actionRect.width || actionCard.offsetWidth || 260));

        panelEl.style.width = `${width}px`;
        panelEl.style.position = 'fixed';
        panelEl.style.visibility = 'hidden';
        panelEl.style.left = '-9999px';
        panelEl.style.top = '0';

        const panelHeight = Math.max(72, Math.round(panelEl.getBoundingClientRect().height || panelEl.offsetHeight || 96));

        placeholder.style.display = 'block';
        placeholder.style.width = '100%';
        placeholder.style.minHeight = `${panelHeight}px`;
        placeholder.style.pointerEvents = 'none';

        panelEl.style.visibility = '';
        return placeholder;
    }

    function positionLibLibFloatingPanel(panelEl) {
        if (!panelEl) {
            return;
        }

        const placeholder = ensureLibLibPlaceholder(panelEl);
        if (!placeholder) {
            return;
        }

        const rect = placeholder.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
        const width = Math.max(220, Math.round(rect.width || panelEl.offsetWidth || 260));
        const left = Math.max(12, Math.min(Math.round(rect.left), viewportWidth - width - 12));
        const top = Math.max(12, Math.round(rect.top));

        panelEl.style.position = 'fixed';
        panelEl.style.left = `${left}px`;
        panelEl.style.top = `${top}px`;
        panelEl.style.width = `${width}px`;
        panelEl.style.maxWidth = `${width}px`;
    }

    function mountLibLibFloatingPanel(panelEl) {
        if (!panelEl) {
            return false;
        }

        if (panelEl.parentElement !== document.body) {
            document.body.appendChild(panelEl);
        }

        ensurePanelInteractive(panelEl);
        positionLibLibFloatingPanel(panelEl);
        return true;
    }

    function positionCivitaiFloatingPanel(panelEl) {
        if (!panelEl) {
            return;
        }

        // 浮层不再插进右侧栏内部，而是悬浮在 body 下。
        // 这样可避免 Civitai 切换版本后侧栏重渲染，把自定义按钮变成“可见但不可点”。
        const anchorCard = findCivitaiInsertAnchor();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
        const gap = 12;

        let width = Math.min(320, Math.max(240, viewportWidth - 32));
        let left = Math.max(12, viewportWidth - width - 16);
        let top = 88;

        if (anchorCard) {
            const rect = anchorCard.getBoundingClientRect();
            const preferredWidth = rect.width > 0
                ? Math.max(220, Math.min(300, Math.round(rect.width * 0.85)))
                : width;
            width = preferredWidth;

            panelEl.style.width = `${width}px`;
            panelEl.style.position = 'fixed';
            panelEl.style.visibility = 'hidden';
            panelEl.style.left = '-9999px';
            panelEl.style.top = '0';
            const panelHeight = Math.max(120, Math.round(panelEl.getBoundingClientRect().height || panelEl.offsetHeight || 220));

            const canPlaceRight = (viewportWidth - rect.right) >= width + gap + 12;
            const canPlaceLeft = rect.left >= width + gap + 12;
            const canPlaceAbove = rect.top >= panelHeight + gap + 72;
            const bottomLimit = Math.max(12, viewportHeight - panelHeight - 12);

            if (canPlaceRight) {
                left = Math.min(Math.round(rect.right + gap), viewportWidth - width - 12);
                top = Math.min(Math.max(72, Math.round(rect.top)), bottomLimit);
            } else if (canPlaceLeft) {
                left = Math.max(12, Math.round(rect.left - width - gap));
                top = Math.min(Math.max(72, Math.round(rect.top)), bottomLimit);
            } else if (canPlaceAbove) {
                left = Math.max(12, Math.min(Math.round(rect.left), viewportWidth - width - 12));
                top = Math.max(72, Math.round(rect.top - panelHeight - gap));
            } else {
                left = Math.max(12, Math.min(Math.round(rect.left), viewportWidth - width - 12));
                top = Math.min(Math.max(72, Math.round(rect.bottom + gap)), bottomLimit);
            }

            panelEl.style.visibility = '';
        }

        panelEl.style.position = 'fixed';
        panelEl.style.left = `${left}px`;
        panelEl.style.top = `${top}px`;
        panelEl.style.width = `${width}px`;
        panelEl.style.maxHeight = `calc(100vh - ${top + 16}px)`;
        panelEl.style.overflow = 'auto';
    }

    function mountCivitaiFloatingPanel(panelEl) {
        if (!panelEl) {
            return false;
        }

        if (panelEl.parentElement !== document.body) {
            document.body.appendChild(panelEl);
        }

        ensurePanelInteractive(panelEl);
        positionCivitaiFloatingPanel(panelEl);
        return true;
    }

    function getCivitaiIdsFromPage() {
        // 版本识别顺序：
        // 1. URL 参数 modelVersionId
        // 2. 当前页面下载链接
        // 3. reviews 链接
        // 4. 右侧代码块中的数字兜底
        const result = {
            modelId: '',
            modelVersionId: ''
        };

        try {
            const currentUrl = new URL(window.location.href);
            const pathMatch = currentUrl.pathname.match(/\/models\/(\d+)/);
            result.modelId = pathMatch?.[1] || '';
            result.modelVersionId = currentUrl.searchParams.get('modelVersionId') || '';
        } catch (_) {
        }

        if (!result.modelVersionId) {
            const downloadLink = document.querySelector('a[href*="/api/download/models/"]');
            const href = downloadLink?.getAttribute('href') || '';
            const downloadMatch = href.match(/\/api\/download\/models\/(\d+)/);
            if (downloadMatch?.[1]) {
                result.modelVersionId = downloadMatch[1];
            }
        }

        if (!result.modelVersionId) {
            const reviewLink = document.querySelector('a[href*="modelVersionId="]');
            const href = reviewLink?.getAttribute('href') || '';
            const versionMatch = href.match(/modelVersionId=(\d+)/);
            if (versionMatch?.[1]) {
                result.modelVersionId = versionMatch[1];
            }
        }

        if (!result.modelVersionId) {
            const codeValues = Array.from(document.querySelectorAll('.mantine-Code-root'))
                .map((element) => getTextContentNormalized(element))
                .filter((text) => /^\d+$/.test(text));
            if (codeValues.length >= 2) {
                result.modelVersionId = codeValues[1];
            }
        }

        return result;
    }

    function findCivitaiInsertAnchor() {
        const isCard = (element) => !!element?.matches?.('.mantine-Card-root[data-with-border="true"], [data-with-border="true"].mantine-Card-root');

        // 优先找顶部动作卡片；找不到时回退到 Download 卡片。
        const bidButton = Array.from(document.querySelectorAll('button'))
            .find((button) => getTextContentNormalized(button) === 'Bid');
        const bidCard = bidButton?.closest('[data-with-border="true"]');
        if (isCard(bidCard) && bidCard.parentElement) {
            return bidCard;
        }

        const downloadLink = document.querySelector('a[href*="/api/download/models/"]');
        const downloadCard = downloadLink?.closest('[data-with-border="true"]');
        if (isCard(downloadCard) && downloadCard.parentElement) {
            const previousCard = downloadCard.previousElementSibling;
            if (isCard(previousCard)) {
                return previousCard;
            }
            return downloadCard;
        }

        const downloadTitle = Array.from(document.querySelectorAll('p, span'))
            .find((element) => getTextContentNormalized(element) === 'Download');
        const titleCard = downloadTitle?.closest('[data-with-border="true"]');
        if (isCard(titleCard) && titleCard.parentElement) {
            const previousCard = titleCard.previousElementSibling;
            if (isCard(previousCard)) {
                return previousCard;
            }
            return titleCard;
        }

        return null;
    }

    function tryInsertButtons(site, div1) {
        if (!div1) {
            return false;
        }

        if (site === 'liblib') {
            return mountLibLibFloatingPanel(div1);
        }

        if (site === 'civitai') {
            return mountCivitaiFloatingPanel(div1);
        }

        return false;
    }








    // ---------------------------------------------------------------
    // 创建按钮
    // ---------------------------------------------------------------
    function createButtons(site) {
        // 统一创建控制面板。liblib 走原地插入，Civitai 走浮层模式。
        const div1 = document.createElement('div');
        div1.id = helperPanelId;
        div1.dataset.helperPanel = 'true';
        div1.style.display = 'flex';
        div1.style.flexDirection = 'column';
        div1.style.justifyContent = "space-between";
        div1.style.alignItems = "stretch";
        div1.style.gap = "6px";
        const brandBlue = '#1E88E5';

        // 统一生成 radio：用于控制“封面选图/选视频”和“是否下载子文件夹内图片”
        const createRadio = (groupName, value, labelText, checked, onChange) => {
            const label = document.createElement('label');
            label.style.display = 'inline-flex';
            label.style.alignItems = 'center';
            label.style.gap = '6px';
            label.style.color = brandBlue;
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = groupName;
            input.value = value;
            input.checked = !!checked;
            input.style.accentColor = brandBlue;
            input.addEventListener('change', () => {
                if (input.checked) onChange(value);
            });
            const text = document.createElement('span');
            text.textContent = labelText;
            text.style.color = brandBlue;
            label.appendChild(input);
            label.appendChild(text);
            return label;
        };

        const createControls = (siteKey) => {
            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.flexWrap = 'wrap';
            controls.style.gap = '12px';
            controls.style.alignItems = 'center';

            // 封面单选：影响封面文件取用策略（封面始终会下载）
            const coverGroup = document.createElement('div');
            coverGroup.style.display = 'inline-flex';
            coverGroup.style.gap = '8px';
            coverGroup.style.alignItems = 'center';
            const coverTitle = document.createElement('span');
            coverTitle.textContent = '封面：';
            coverTitle.style.color = brandBlue;
            coverGroup.appendChild(coverTitle);
            coverGroup.appendChild(createRadio(`${siteKey}_cover_mode`, 'image', '图片', coverSaveMode === 'image', (v) => { coverSaveMode = v; }));
            coverGroup.appendChild(createRadio(`${siteKey}_cover_mode`, 'video', '视频', coverSaveMode === 'video', (v) => { coverSaveMode = v; }));

            // 下载图片单选：仅控制 model_name_ver 子文件夹内的图片下载；不影响封面、不影响文本文件写入
            const dlGroup = document.createElement('div');
            dlGroup.style.display = 'inline-flex';
            dlGroup.style.gap = '8px';
            dlGroup.style.alignItems = 'center';
            const dlTitle = document.createElement('span');
            dlTitle.textContent = '下载图片：';
            dlTitle.style.color = brandBlue;
            dlGroup.appendChild(dlTitle);
            dlGroup.appendChild(createRadio(`${siteKey}_dl_images`, 'yes', '是', downloadImages === true, () => { downloadImages = true; }));
            dlGroup.appendChild(createRadio(`${siteKey}_dl_images`, 'no', '否', downloadImages === false, () => { downloadImages = false; }));

            controls.appendChild(coverGroup);
            controls.appendChild(dlGroup);
            return controls;
        };

        if (site === 'liblib') {
            div1.style.padding = '8px 0';
            div1.style.boxSizing = 'border-box';
            div1.appendChild(createControls('liblib'));
            const button1 = document.createElement('button');
            button1.type = 'button';
            button1.dataset.helperAction = 'download-liblib';
            button1.textContent = '下载封面+生成信息';
            button1.addEventListener('click', () => saveLibLibAuthImagesInfo(button1));
            button1.style.padding = '15px';
            button1.style.width = "200px";
            button1.style.backgroundColor = 'red';
            button1.style.color = 'white';
            button1.style.display = 'block';
            button1.style.flex = "1";
            button1.style.borderRadius = '8px'; // 设置圆角半径
            button1.style.cursor = 'pointer';
            button1.style.pointerEvents = 'auto';
            div1.appendChild(button1);
        } else if (site === 'civitai') {
            div1.style.padding = '12px';
            div1.style.background = 'var(--mantine-color-dark-6, #25262b)';
            div1.style.border = '1px solid var(--mantine-color-dark-4, #373a40)';
            div1.style.borderRadius = '8px';
            div1.style.boxSizing = 'border-box';
            div1.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)';
            div1.style.minWidth = '220px';
            div1.style.maxWidth = '300px';
            div1.appendChild(createControls('civitai'));
            const button2 = document.createElement('button');
            button2.type = 'button';
            button2.dataset.helperAction = 'download-civitai';
            button2.textContent = '下载封面+生成信息';
            button2.addEventListener('click', () => saveCivitaiModelInfo(button2));
            button2.style.padding = '15px';
            button2.style.width = "100%";
            button2.style.setProperty('background-color', 'blue', 'important'); // 使用 setProperty
            button2.style.color = 'white';
            button2.style.display = 'block';
            button2.style.flex = "1";
            button2.style.borderRadius = '4px';
            button2.style.marginBottom = '5px';
            button2.style.cursor = 'pointer';
            button2.style.pointerEvents = 'auto';
            div1.appendChild(button2);
        }

        ensurePanelInteractive(div1);

        return div1;
    }

    // ---------------------------------------------------------------
    // 监听器
    // ---------------------------------------------------------------
    function createObserver(site, div1) {
        let scheduled = false;

        // 页面频繁重渲染时，重复执行“挂载 + 修复交互 + 重算位置”。
        const healPanel = () => {
            ensurePanelInteractive(div1);
            tryInsertButtons(site, div1);
        };

        const scheduleInsert = () => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                healPanel();
                [120, 400, 1000, 2200].forEach((delay) => {
                    setTimeout(healPanel, delay);
                });
            });
        };

        const observer = new MutationObserver(function (mutations) {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    scheduleInsert();
                    break;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        if (site === 'liblib' || site === 'civitai') {
            window.addEventListener('resize', scheduleInsert, { passive: true });
            window.addEventListener('scroll', scheduleInsert, { passive: true });
        }
        scheduleInsert();
    }

    // ---------------------------------------------------------------
    // 主函数
    // ---------------------------------------------------------------
    (function () {
        const site = currentSite();
        const buttonsDiv = createButtons(site);

        if (site === 'liblib' || site === 'civitai') {
            createObserver(site, buttonsDiv);
        } else {
            console.log("Unsupported site.");
        }
    })();
})();
