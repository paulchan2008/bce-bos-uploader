/**
 * Copyright (c) 2014 Baidu.com, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

var AK = getQuery('ak', 'afe4759592064eee930682e399249aba');
var SK = getQuery('sk', '7785ea912b06449f8cbd084998a1e400');

var VOD_ENDPOINT = getQuery('vod.endpoint', 'http://vod.baidubce.com');
var VOD_BUCKET = getQuery('vod.bucket', 'vod-gauddsywyhn713kc');
var VOD_EXTS = 'avi,mp4,flv,rm,rmvb,webm'.split(',');

var BOS_ENDPOINT = getQuery('bos.endpoint', 'http://bj.bcebos.com');
var BOS_BUCKET = 'eduyun';

var DOC_ENDPOINT = getQuery('doc.endpoint', 'http://doc.baidubce.com');
var DOC_BUCKET = getQuery('doc.bucket', 'bkt-gawizxekph7vrnmb');
var DOC_EXTS = 'txt,pdf,doc,docx,ppt,pptx,xls,xlsx'.split(',');
var DOC_MAX_SIZE = baidubce.utils.parseSize('100Mb');   // 文档最大 100Mb

var CHUNK_SIZE = '1m';

var doc = new baidubce.sdk.DocClient.Document({
  endpoint: DOC_ENDPOINT,
  credentials: {ak: AK, sk: SK}
});

var vod = new baidubce.sdk.VodClient({
  endpoint: VOD_ENDPOINT,
  credentials: {ak: AK, sk: SK}
});

function uuid() {
  var value = Math.random() * Math.pow(2, 60);
  return parseInt(value).toString(36);
}

function getLSIndex(type, file) {
  var index = [type, AK, file.name, file.size, CHUNK_SIZE].join('&');
  return index;
}

function getUUIDFile(type, file) {
    var chunks = file.name.split('.');
    var ext = chunks.length > 1 ? chunks.pop() : '';

    return type + '-' + uuid() + (ext ? '.' + ext : '');
}

function finVodKey(file, info) {
  var localKey = getLSIndex('vod', file);
  localStorage.removeItem(localKey);

  vod._internalCreateMediaResource(file.__mediaId, file.name, '测试文件')
    .then(function () {
      var row = getRowById(file.__id);
      row.setMediaId(file.__mediaId);
    });
}

function getVodKey(file) {
  var localKey = getLSIndex('vod', file);
  var localValue = localStorage.getItem(localKey);
  if (!localValue) {
    return vod.buildRequest('POST', null, 'apply').then(function (response) {
      var mediaId = response.body.mediaId;
      var bucket = response.body.sourceBucket;
      var key = response.body.sourceKey;
      localStorage.setItem(localKey, JSON.stringify(response.body));
      file.__mediaId = mediaId;
      file.__object = key;
      file.__done = finVodKey;
      return {
        bucket: bucket,
        key: key
      };
    });
  }
  else {
    localValue = JSON.parse(localValue);
    file.__mediaId = localValue.mediaId;
    file.__object = localValue.sourceKey;
    file.__done = finVodKey;
    return {
      bucket: localValue.sourceBucket,
      key: localValue.sourceKey
    };
  }
}

function finDocKey(file, info) {
  var localKey = getLSIndex('doc', file);
  localStorage.removeItem(localKey);

  doc.createFromBos(DOC_BUCKET, file.__object, file.name)
    .then(function (response) {
      var row = getRowById(file.__id);
      row.setMediaId(response.body.documentId);
    });
}

function getDocKey(file) {
  if (file.size > DOC_MAX_SIZE) {
    // 如果文档超过了允许的体积，就直接上传到 BOS
    return getBosKey(file);
  }

  var localKey = getLSIndex('doc', file);
  var localValue = localStorage.getItem(localKey) || getUUIDFile('doc', file);
  localStorage.setItem(localKey, localValue);

  file.__target = 'doc';
  file.__object = 'source/' + localValue;
  file.__done = finDocKey;

  return {
    bucket: DOC_BUCKET,
    key: file.__object
  };
}

function finBosKey(file) {
  var localKey = getLSIndex('bos', file);
  localStorage.removeItem(localKey);

  var row = getRowById(file.__id);
  row.setMediaId(file.__bosId);
}

function getBosKey(file) {
  var localKey = getLSIndex('bos', file);
  var localValue = localStorage.getItem(localKey) || getUUIDFile('bos', file);
  localStorage.setItem(localKey, localValue);

  file.__bosId = localValue;
  file.__object = 'uuid/' + localValue;
  file.__done = finBosKey;

  return {
    bucket: BOS_BUCKET,
    key: file.__object
  };
}

function getKey(file) {
  var chunks = file.name.split('.');
  var ext = chunks.length > 1 ? chunks.pop() : '';

  if (ext && VOD_EXTS.indexOf(ext) != -1) {
    // 往视频服务上传
    return getVodKey(file);
  }
  else if (ext && DOC_EXTS.indexOf(ext) != -1) {
    // 往文档服务上传
    return getDocKey(file);
  }
  else {
    // 往BOS上传
    return getBosKey(file);
  }
}

var uploader = new baidubce.bos.Uploader({
  browse_button: '#file',
  multi_selection: true,
  bos_endpoint: BOS_ENDPOINT,
  bos_bucket: BOS_BUCKET,
  bos_ak: AK,
  bos_sk: SK,
  max_file_size: '1Gb',
  chunk_size: CHUNK_SIZE,
  flash_swf_url: '../bower_components/moxie/bin/flash/Moxie.swf',
  init: {
    FilesFilter: function (_, files) {
      // 添加更多的过滤规则，比如文件大小之类的
    },
    FilesAdded: function (_, files) {
      FilesAdded(_, files);
    },
    BeforeUpload: function (_, file) {
      file.__startTime = new Date().getTime();
      var row = getRowById(file.__id);
      row.setStatus('circle-arrow-up');
    },
    UploadProgress: function (_, file, progress, event) {
      var row = getRowById(file.__id);
      row.setProgress(progress);
    },
    ObjectMetas: function (_, file) {
      if (file.__target === 'doc') {
        // 如果文档进入 Multipart Upload 的模式，必须手工设置 x-bce-meta-md5
        // 如果是正常的 PutObject 模式，服务器会设置 ETag
        // 另外，文档会被限制在 100Mb 以内，所以本地计算 md5 应该不会特别慢
        return baidubce.utils.md5sum(file).then(function (md5) {
          return {
            'x-bce-meta-md5': md5
          };
        });
      }
    },
    Key: function (_, file) {
      return getKey(file);
    },
    FileUploaded: function (_, file, info) {
      localStorage.removeItem(file.__uploadId);

      var time = ((new Date().getTime() - file.__startTime) / 1000).toFixed(2);
      var row = getRowById(file.__id);
      var url = [BOS_ENDPOINT, info.body.bucket, info.body.object].join('/');

      row.setStatus('ok-circle', true);
      row.setUrl(url);
      row.setTime(time);

      file.__done(file, info);
    },
    NetworkSpeed: function (_, bytes, time, pendings) {
      var speed = bytes / (time / 1000);
      var html = '上传速度：' + humanize.filesize(speed) + '/s';
      var seconds = pendings / speed;
      if (seconds > 1) {
        var dhms = baidubce.utils.toDHMS(Math.ceil(seconds));
        html += '，剩余时间：' + [
          humanize.pad(dhms.HH, 2, '0'),
          humanize.pad(dhms.MM, 2, '0'),
          humanize.pad(dhms.SS, 2, '0')
        ].join(':');
      }

      $('.network-speed').html(html);
    },
    UploadComplete: function () {
      $('button[type=submit]').attr('disabled', true);
    },
    ListParts: function (_, file, uploadId) {
      // 恢复断点续传的时候，从本地获取 parts 的信息，避免从服务读取
      // 有时候服务器没有开放读取的权限
      try {
        var parts = localStorage.getItem(uploadId);
        return JSON.parse(parts);
      }
      catch (ex) {
      }
    },
    ChunkUploaded: function (_, file, result) {
      var partNumber = result.partNumber;
      var uploadId = result.uploadId;
      var response = result.response;
      var eTag = response.http_headers.etag;

      file.__uploadId = uploadId;

      if (eTag) {
        var parts = localStorage.getItem(uploadId);
        if (!parts) {
          parts = [];
        }
        else {
          parts = JSON.parse(parts);
        }

        parts.push({
          partNumber: partNumber,
          eTag: eTag
        });

        localStorage.setItem(uploadId, JSON.stringify(parts));
      }
    },
    Error: function (_, error, file) {
      var row = getRowById(file.__id);
      if (error.status_code === 0) {
        row.setStatus('pause', true);
      }
      else {
        row.setStatus('remove-circle', false);
        var errorMessage = $.isPlainObject(error) ? JSON.stringify(error) : String(error);
        row.setErrorMessage(errorMessage);
      }
    }
  }
});

$('button[type=submit]').click(function () {
  uploader.start();
  return false;
});











/* vim: set ts=4 sw=4 sts=4 tw=120: */