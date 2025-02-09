// ==UserScript==
// @name         liblib|civitai助手-封面+模型信息
// @namespace    http://tampermonkey.net/
// @version      1.0.29
// @description  liblib|civitai助手，下载封面+模型信息
// @author       kaiery
// @match        https://www.liblib.ai/modelinfo/*
// @match        https://www.liblib.art/modelinfo/*
// @match        https://civitai.com/models/*
// @grant        none
// @license      MIT License
// @downloadURL https://update.greasyfork.org/scripts/508360/liblib%E5%8A%A9%E6%89%8B-%E5%B0%81%E9%9D%A2%2B%E6%A8%A1%E5%9E%8B%E4%BF%A1%E6%81%AF.user.js
// @updateURL https://update.greasyfork.org/scripts/508360/liblib%E5%8A%A9%E6%89%8B-%E5%B0%81%E9%9D%A2%2B%E6%A8%A1%E5%9E%8B%E4%BF%A1%E6%81%AF.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // 定义全局变量
    // var modelDir;
    var model_name_ver;
    var textDesc, uuid, buildId, webid, modelId, modelName, modelVersionId, downloadUrl;
    var page = 1;
    var pageSize = 16;
    var sortType = 0;
    const default_download_pic_num = 100;


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

    // ---------------------------------------------------------------
    // demo
    // ---------------------------------------------------------------
    async function createDirectory() {
        // open directory picker
        const dirHandle = await window.showDirectoryPicker({mode: "readwrite"});
        // create a new directory named 'newDir'
        const newDirHandle = await dirHandle.getDirectoryHandle('newDir', {create: true});
        console.log(newDirHandle);
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
    async function saveLibLibAuthImagesInfo() {
        // 1:CheckPoint 2:embedding；3：HYPERNETWORK ；4：AESTHETIC GRADIENT; 5：Lora；6：LyCORIS;  9:WILDCARDS
        let modelType = 1;

        // open directory picker
        const dirHandle = await window.showDirectoryPicker({mode: "readwrite"});

        // 根据选项卡获取模型版本id
        const div = document.querySelector('.ant-tabs-tab.ant-tabs-tab-active');
        const modelVersionId = parseInt(div.getAttribute('data-node-key'));
        const modelVer = div.innerText.replace(/[/\\?%*:|"<>]/g, '-');

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
            // Get the content of the script element
            const scriptContent = document.getElementById('__NEXT_DATA__').textContent;
            const scriptJson = JSON.parse(scriptContent);

            // Extract uuid, buildId, and webid
            uuid = scriptJson.query.uuid;
            buildId = scriptJson.buildId;
            webid = scriptJson.props.webid;
            //------------
            // 预请求地址
            const url_acceptor = "https://www.liblib.art/api/www/log/acceptor/f?timestamp=" + Date.now();
            // var url_acceptor = "https://liblib-api.vibrou.com/api/www/log/acceptor/f?timestamp="+Date.now();
            // 模型信息地址
            const url_model = "https://www.liblib.art/api/www/model/getByUuid/" + uuid + "?timestamp=" + Date.now();
            // var url_model = "https://liblib-api.vibrou.com/api/www/model/getByUuid/" + uuid;


            // 发送预请求-------------------------------------------------------
            const resp_acc = await fetch(url_acceptor, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({timestamp: Date.now()})
            })

            // 发送模型信息
            const resp = await fetch(url_model, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({timestamp: Date.now()})
            })

            const model_data = await resp.json();
            // console.log("----------模型信息-----------");
            // console.log(model_data);

            if (model_data.code !== 0) {
                return;
            }

            modelId = model_data.data.id
            modelName = model_data.data.name.replace(/[/\\?%*:|"<>]/g, '-');

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

            // console.log(modelDir+"/"+modelName);

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
                    let isCover = false;

                    for (const authImage of authImages) {
                        const authImageUrl = authImage.imageUrl;
                        var authimageName = authImage.id;
                        var authimageExt = authImageUrl.split("/").pop().split(".").pop();
                        var tmp = authimageExt.indexOf("?");
                        if (tmp > 0) {
                            authimageExt = authimageExt.substring(0, tmp);
                        }

                        const authImageUuid = authImage.uuid;
                        const generateInfo = authImage.generateInfo;
                        if (generateInfo) {
                            if (generateInfo.prompt) {
                                promptList.push(generateInfo.prompt)
                            }
                        }

                        if (!isCover) {
                            // 下载封面图片
                            isCover = true;
                            // 下载图片
                            const resp_download = await fetch(authImageUrl);
                            const blob = await resp_download.blob();
                            // 获取文件句柄
                            const fileName = model_name_ver + "." + authimageExt;
                            const picHandle = await dirHandle.getFileHandle(fileName, {create: true});
                            // 写入图片
                            const writable = await picHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                            console.log("Image written to file:", fileName);
                            // break;
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
                    const modelDirHandle = await dirHandle.getDirectoryHandle(model_name_ver, {create: true});
                    // 获取文件句柄
                    const savejsonHandle = await modelDirHandle.getFileHandle(modelName + ".json", {create: true});
                    // 写入模型信息json文件
                    const writablejson = await savejsonHandle.createWritable();
                    await writablejson.write(JSON.stringify(modelInfoJson, null, 4));
                    await writablejson.close();

                    // 创建模型版本目录
                    // const modelVerDirHandle = await modelDirHandle.getDirectoryHandle(modelName, {create: true});
                    // 获取文件句柄
                    const saveExampleHandle = await modelDirHandle.getFileHandle("example.txt", {create: true});
                    const writableExample = await saveExampleHandle.createWritable();
                    await writableExample.write(triggerWord + '\n\n');
                    // 写入字符串数组
                    for (const str of promptList) {
                        await writableExample.write(str + '\n\n');
                    }
                    await writableExample.close();
                }
            }
        }
        alert("封面信息下载完成");
    }

    // ---------------------------------------------------------------
    // 保存封面信息
    // ---------------------------------------------------------------
    async function saveCivitaiModelInfo() {
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

        // open directory picker
        const dirHandle = await window.showDirectoryPicker({mode: "readwrite"});


        // 获取模型id和模型版本id
        const codeElements = document.querySelectorAll('.mantine-Code-root');
        if (codeElements.length >= 4) {
            const value1 = codeElements[1].textContent;
            const value2 = codeElements[3].textContent;
            modelId = value1;
            modelVersionId = value2;

            // 接口url
            const url_model = "https://civitai.com/api/v1/models/" + modelId;

            // 获取模型介绍文本
            textDesc = extractCivitaiTextFromSecondSpoiler();
            // console.log(textDesc)
            console.log('request model info url ');
            // 发送模型信息
            const resp = await fetch(url_model, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({timestamp: Date.now()})
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
                alert(`模型信息为空`);
                return;
            }

            //检查 data 是否包含 error 和 message
            if (model_data.message && model_data.error) {
                console.log(`数据为空 *************************************************************`);
                alert(`数据为空`);
                return;
            }
            // console.log("----------模型信息-----------");
            // console.log(JSON.stringify(model_data, null, 4));
            // console.log(JSON.stringify(model_data));

            modelName = model_data.name.replace(/[/\\?%*:|"<>]/g, '-');

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
            if(modelTypeName === '未分类'){
                if('type' in model_data){
                    modelTypeName = model_data.type
                }
            }
            // 模型版本数组
            let versions = model_data.modelVersions;

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
                    console.log(files);

                    if (files.length === 1){
                        modelFile = files[0].name;
                        split = splitFilename(modelFile);
                        model_name_ver = split.name;
                    }else{
                        // 弹出选择模型文件框---------------------
                        const selectedObject = await showObjectSelectionDialog(files);
                        if (!selectedObject) {
                            return;
                        }
                        // end
                        // console.log("选择的对象:", `提交: ${selectedObject.name} (${selectedObject.sizeKB} KB)`);
                        // model_name_ver = selectedObject.name
                        modelFile = selectedObject.name;
                        split = splitFilename(modelFile);
                        // console.log(`文件名: ${selectedObject.name}`);
                        // console.log(`  文件名部分: ${split.name}`);
                        // console.log(`  扩展名: ${split.extension}`);
                        model_name_ver = split.name;
                    }

                    // 模型介绍
                    textDesc = verItem.description + '\n\n' + textDesc;
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

                    // 图片信息-------------
                    let authImages = verItem.images;

                    authImages = authImages.filter(item => item && item.type === 'image');

                    // console.log(authImages);
                    let images = [];
                    for (const img of authImages){
                        if(img.type === 'image'){
                            images.push(img);
                        }
                    }

                    // 获取样图id数组-------------------
                    const imageIds = getImageIds(images); // 直接调用，getImageIds 应该是同步的
                    if (imageIds.length > 0) {
                        // 获取样图信息
                        example = await getImageExample(imageIds);
                        // 🌟🌟🌟 在这里立即继续编写逻辑 🌟🌟🌟
                        // 安全地使用 'example' 数组，因为它已经被赋值
                        if (example.length > 0) {
                            example.forEach(item => {
                                // 对 example 数组中的每个 item 执行操作
                                // console.log("Processing item:", item);
                                let itemType = item?.result?.data?.json?.type ?? undefined;
                                let meta = item?.result?.data?.json?.meta ?? undefined;
                                if (meta !== undefined && itemType === 'image') {
                                    promptList.push(meta);
                                }
                            });
                        }
                    }

                    // 封面图片
                    let isCover = false;
                    for (const authImage of authImages) {
                        const authImageUrl = authImage.url;
                        let authimageExt = authImageUrl.split("/").pop().split(".").pop();
                        const tmp = authimageExt.indexOf("?");
                        if (tmp > 0) {
                            authimageExt = authimageExt.substring(0, tmp);
                        }
                        if (!isCover) {
                            // console.log(authImageUrl)
                            // 下载封面图片
                            isCover = true;
                            // 下载图片
                            const resp_download = await fetch(authImageUrl);
                            const blob = await resp_download.blob();
                            // 获取文件句柄
                            const fileName = model_name_ver + "." + authimageExt;
                            const picHandle = await dirHandle.getFileHandle(fileName, {create: true});
                            // 写入图片
                            const writable = await picHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                            console.log("Image written to file:", fileName);
                            // break;
                        }
                    }

                    let triggerWord = '触发词：';
                    if ('trainedWords' in verItem && verItem.trainedWords) {
                        triggerWord = triggerWord + verItem.trainedWords
                    } else {
                        triggerWord = triggerWord + "无";
                    }
                    modelInfoJson.triggerWord = triggerWord
                    // console.log(JSON.stringify(modelInfoJson, null, 4));

                    // 创建模型目录( 模型+版本名 )
                    const modelDirHandle = await dirHandle.getDirectoryHandle(model_name_ver, {create: true});
                    // 获取文件句柄
                    const savejsonHandle = await modelDirHandle.getFileHandle(modelName + ".json", {create: true});
                    // 写入模型信息json文件
                    const writablejson = await savejsonHandle.createWritable();
                    await writablejson.write(JSON.stringify(modelInfoJson, null, 4));
                    await writablejson.close();

                    // 获取文件句柄
                    const saveExampleHandle = await modelDirHandle.getFileHandle("example.txt", {create: true});
                    const writableExample = await saveExampleHandle.createWritable();
                    await writableExample.write(triggerWord + '\n\n');
                    // 写入字符串数组
                    for (const str of promptList) {
                        await writableExample.write(JSON.stringify(str, null, 4) + '\n\n');
                    }
                    await writableExample.close();

                } // 匹配版本end
            } // 循环versions


            alert("封面信息下载完成");

        } else {
            alert("未找到模型ID信息");
        }
    }

    function extractCivitaiTextFromSecondSpoiler() {
        // 获取所有的 mantine-Spoiler-content 元素
        const spoilerElements = document.querySelectorAll('.mantine-Spoiler-content');
        // 检查是否有至少两个元素
        if (spoilerElements.length < 2) {
            console.warn("少于两个 .mantine-Spoiler-content 元素");
            return null; // 或者返回一个空字符串 ""
        }
        // 获取第二个元素
        const secondSpoiler = spoilerElements[1];
        // 提取文本内容，并替换 <p> 标签为换行符
        return extractCivitaiText(secondSpoiler);
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

    // 获取图像 ID 数组
    function getImageIds(images) {
        const imageIds = [];
        for (const image of images) {
            const url = image.url;
            const A = url.split('/').pop(); // 使用 pop() 更简洁地获取最后一个元素
            const imgId = A.split('.')[0];
            imageIds.push(imgId);
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
                const url = `https://civitai.com/api/trpc/image.getGenerationData?input=${encodedImageId}`;

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
            form.addEventListener('submit', function(event) {
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









    // ---------------------------------------------------------------
    // 创建按钮
    // ---------------------------------------------------------------
    function createButtons(site) {
        // 定义元素------------------------------------
        const div1 = document.createElement('div');
        div1.style.display = 'flex';
        div1.style.justifyContent = "space-between";
        div1.style.alignItems = "center";
        if (site === 'liblib') {
            const button1 = document.createElement('button');
            button1.textContent = '下载封面+生成信息';
            button1.onclick = saveLibLibAuthImagesInfo;
            button1.style.padding = '15px';
            button1.style.width = "200px";
            button1.style.backgroundColor = 'red';
            button1.style.color = 'white';
            button1.style.display = 'block';
            button1.style.flex = "1";
            button1.style.borderRadius = '8px'; // 设置圆角半径
            div1.appendChild(button1);
        } else if (site === 'civitai') {
            const button2 = document.createElement('button');
            button2.textContent = '下载封面+生成信息 (Civitai)';
            button2.onclick = saveCivitaiModelInfo;
            button2.style.padding = '15px';
            button2.style.width = "100%";
            button2.style.setProperty('background-color', 'blue', 'important'); // 使用 setProperty
            button2.style.color = 'white';
            button2.style.display = 'block';
            button2.style.flex = "1";
            button2.style.borderRadius = '4px';
            button2.style.marginBottom = '5px';
            div1.appendChild(button2);
        }

        return div1;
    }

    // ---------------------------------------------------------------
    // 监听器
    // ---------------------------------------------------------------
    function createObserver(site, div1) {
        // 监听
        const observer = new MutationObserver(function (mutations) {
            let found = false;
            mutations.forEach(function (mutation) {
                if (mutation.type === 'childList' && !found) {
                    const allElements = document.querySelectorAll('div');
                    allElements.forEach(function (element) {
                        const classNames = element.className.split(/\s+/);
                        for (let i = 0; i < classNames.length; i++) {
                            if (site === 'liblib') {
                                if (classNames[i].startsWith('ModelDescription_desc')) {
                                    found = true;
                                    observer.disconnect(); // 停止观察
                                    const actionCard = document.querySelector('[class^="ModelActionCard_modelActionCard"]');
                                    if (actionCard) {
                                        actionCard.parentNode.insertBefore(div1, actionCard);
                                    }
                                    break;
                                }
                            } else if (site === 'civitai') {
                                if (classNames[i].includes('mantine-ContainerGrid-root')) {
                                    found = true;
                                    observer.disconnect(); // 停止观察
                                    // 获取目标 div (divroot)
                                    const divroot = element;
                                    // 确保 divroot 存在且有子节点
                                    if (divroot && divroot.children.length > 0) {
                                        // 获取第一个子节点 (class="mantine-ContainerGrid-col")
                                        const firstChild = divroot.children[0];
                                        // 确保第一个子节点存在
                                        if (firstChild) {
                                            // 将 div1 插入到第一个子节点的最前面
                                            firstChild.insertBefore(div1, firstChild.firstChild); // 注意这里使用了 firstChild.firstChild
                                            div1.style.display = 'block'; // 确保 div1 可见
                                        } else {
                                            console.warn("Civitai: 第一个子节点不存在");
                                        }
                                    } else {
                                        console.warn("Civitai: divroot 不存在或没有子节点");
                                    }
                                    break;
                                }
                            }
                            break;
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {childList: true, subtree: true});
    }

    // ---------------------------------------------------------------
    // 主函数
    // ---------------------------------------------------------------
    (function () {
        const site = currentSite();
        // console.log("Current site:", site);
        const buttonsDiv = createButtons(site);

        if (site === 'liblib' || site === 'civitai') {
            createObserver(site, buttonsDiv);
        } else {
            console.log("Unsupported site.");
        }
    })();
})();