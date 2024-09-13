// ==UserScript==
// @name         liblib助手-封面+模型信息
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  liblib助手，下载封面+模型信息
// @author       kaiery
// @match        https://www.liblib.ai/modelinfo/*
// @match        https://www.liblib.art/modelinfo/*
// @grant        none
// @license      MIT License
// @downloadURL https://github.com/kaiery/liblib_helper/blob/main/liblib_helper2.js
// @updateURL https://github.com/kaiery/liblib_helper/blob/main/liblib_helper2.js
// ==/UserScript==

(function() {
    'use strict';

    // 定义全局变量
    var modelDir;
    var textDesc, uuid, buildId, webid, modelId, modelName, modelVersionId, downloadUrl;
    var page = 1;
    var pageSize = 16;
    var sortType = 0;
    const default_download_pic_num = 100;

    // ---------------------------------------------------------------
    // demo
    // ---------------------------------------------------------------
    async function createDirectory() {
        // open directory picker
        const dirHandle = await window.showDirectoryPicker({mode:"readwrite"});
        // create a new directory named 'newDir'
        const newDirHandle = await dirHandle.getDirectoryHandle('newDir', {create: true});
        console.log(newDirHandle);
    }


    // ---------------------------------------------------------------
    // html转文本
    // ---------------------------------------------------------------
    function htmlToText(html) {
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        var text = '';
        for (var i = 0; i < tempDiv.childNodes.length; i++) {
            if (tempDiv.childNodes[i].nodeName === 'P') {
                text += tempDiv.childNodes[i].textContent + '\n';
            }
        }
        return text;
    }
    // ---------------------------------------------------------------
    // 保存封面信息
    // ---------------------------------------------------------------
    async function saveAuthImagesInfo() {
        var modelType = 1; // 1:CheckPoint 2:embedding；3：HYPERNETWORK ；4：AESTHETIC GRADIENT; 5：Lora；6：LyCORIS;  9:WILDCARDS
        var hasTriggerWord = false;

        // open directory picker
        const dirHandle = await window.showDirectoryPicker({mode:"readwrite"});

        // 根据选项卡获取模型版本id
        const div = document.querySelector('.ant-tabs-tab.ant-tabs-tab-active');
        const modelVersionId = parseInt(div.getAttribute('data-node-key'));
        const modelVer = div.innerText.replace(/ /g, "").replace(/[/\\?%*:|"<>]/g, '');

        var allElements = document.querySelectorAll('div');
        allElements.forEach(function(element) {
            var classNames = element.className.split(/\s+/);
            for (var i = 0; i < classNames.length; i++) {
                if (classNames[i].startsWith('ModelDescription_desc')) {
                    textDesc = htmlToText(element.innerHTML);
                    textDesc = textDesc.replace(/\\n/g, '\n');
                    break;
                }
            }
        });
        if(textDesc){
            // Get the content of the script element
            var scriptContent = document.getElementById('__NEXT_DATA__').textContent;
            var scriptJson = JSON.parse(scriptContent);

            // Extract uuid, buildId, and webid
            uuid = scriptJson.query.uuid;
            buildId = scriptJson.buildId;
            webid = scriptJson.props.webid;
            //------------
            // 预请求地址
            var url_acceptor = "https://liblib-api.vibrou.com/api/www/log/acceptor/f";
            // 模型信息地址
            var url_model = "https://liblib-api.vibrou.com/api/www/model/getByUuid/" + uuid;


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

            if(model_data.code!==0){ return;}

            modelId = model_data.data.id
            modelName = model_data.data.name.replace(/ /g, "").replace(/[/\\?%*:|"<>]/g, '');
            modelDir = modelName;
            modelName = modelDir+"_"+modelVer;
            if(modelName.slice(-1)==='.'){
                modelName = modelName.substring(0, modelName.length -1);
            }
            modelType = model_data.data.modelType // 1:CheckPoint 2:embedding；3：HYPERNETWORK ；4：AESTHETIC GRADIENT; 5：Lora；6：LyCORIS;  9:WILDCARDS

            var modelTypeName = '未分类'
            switch (modelType){
                case 1:
                    modelTypeName = 'CheckPoint'
                    hasTriggerWord = false
                    break;
                case 2:
                    modelTypeName = 'embedding'
                    hasTriggerWord = true
                    break;
                case 3:
                    modelTypeName = 'HYPERNETWORK'
                    hasTriggerWord = true
                    break;
                case 4:
                    modelTypeName = 'AESTHETIC GRADIENT'
                    hasTriggerWord = true
                    break;
                case 5:
                    modelTypeName = 'Lora'
                    hasTriggerWord = true
                    break;
                case 6:
                    modelTypeName = 'LyCORIS'
                    hasTriggerWord = true
                    break;
                case 9:
                    modelTypeName = 'WILDCARDS'
                    hasTriggerWord = true
                    break;
            }

            // console.log(modelDir+"/"+modelName);

            const versions = model_data.data.versions;
            for (const verItem of versions){
                // 匹配版本号
                if(verItem.id === modelVersionId){

                    // 模型信息json信息
                    var modelInfoJson = {
                        modelType:modelTypeName,
                        description: textDesc,
                        uuid: uuid,
                        buildId: buildId,
                        webid: webid
                    };

                    var triggerWord = '无';
                    if(hasTriggerWord){
                        if('triggerWord' in verItem && verItem.triggerWord){
                           triggerWord = verItem.triggerWord
                           modelInfoJson.triggerWord = triggerWord
                        }
                    }


                    // 创建模型目录
                    const modelDirHandle = await dirHandle.getDirectoryHandle(modelDir, {create: true});
                    // 创建模型版本目录
                    const modelVerDirHandle = await modelDirHandle.getDirectoryHandle(modelName, {create: true});
                    // 获取文件句柄
                    const savejsonHandle = await modelDirHandle.getFileHandle(modelName+".json", { create: true });
                    // 写入模型信息json文件
                    const writablejson = await savejsonHandle.createWritable();
                    await writablejson.write(JSON.stringify(modelInfoJson));
                    await writablejson.close();


                    const authImages = verItem.imageGroup.images;
                    let isCover = false;

                    for(const authImage of authImages){
                        const authImageUrl = authImage.imageUrl;
                        var authimageName = authImage.id;
                        var authimageExt = authImageUrl.split("/").pop().split(".").pop();
                        var tmp = authimageExt.indexOf("?");
                        if (tmp>0){
                            authimageExt = authimageExt.substring(0,tmp);
                        }

                        const authImageUuid = authImage.uuid;

                        if(!isCover){
                            // 下载封面图片
                            isCover = true;
                            // 下载图片
                            const resp_download = await fetch(authImageUrl);
                            const blob = await resp_download.blob();
                            // 获取文件句柄
                            const picHandle = await modelDirHandle.getFileHandle(modelName+"."+authimageExt, { create: true });
                            // 写入图片
                            const writable = await picHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                            break;
                        }
                    }
                }
            }
        }
        alert("封面信息下载完成");
    }



    // 定义元素------------------------------------
    var div1 = document.createElement('div');
    div1.style.display = 'flex';
    div1.style.justifyContent="space-between";
    div1.style.alignItems = "center";

    var button1 = document.createElement('button');
    button1.textContent = '下载封面+生成信息';
    button1.onclick = saveAuthImagesInfo;
    button1.style.padding = '10px';
    button1.style.width = "200px";
    button1.style.backgroundColor = 'green';
    button1.style.color = 'white';
    button1.style.display = 'none';
    button1.style.flex = "1";

    div1.appendChild(button1);

    // 监听
    var observer = new MutationObserver(function(mutations) {
        var found = false;
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && !found) {
                var allElements = document.querySelectorAll('div');
                allElements.forEach(function(element) {
                    var classNames = element.className.split(/\s+/);
                    for (var i = 0; i < classNames.length; i++) {
                        if (classNames[i].startsWith('ModelDescription_desc')) {
                            found = true;
                            observer.disconnect(); // 停止观察
                            var actionCard = document.querySelector('[class^="ModelActionCard_modelActionCard"]');
                            if (actionCard) {
                                actionCard.parentNode.insertBefore(div1, actionCard);

                                button1.style.display = 'block';
                            }
                            break;
                        }
                    }
                });
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();