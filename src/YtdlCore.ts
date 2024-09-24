type YTDL_Constructor = Omit<YTDL_DownloadOptions, 'format'> & {
    logDisplay?: Array<'debug' | 'info' | 'success' | 'warning' | 'error'>;
};

import { YTDL_ChooseFormatOptions, YTDL_DownloadOptions, YTDL_GetInfoOptions, YTDL_ClientTypes, YTDL_Agent, YTDL_Hreflang, YTDL_GeoCountry, YTDL_VideoInfo, YTDL_OAuth2Credentials, YTDL_ProxyOptions } from './types';
import { InternalDownloadOptions } from './core/types';

import { Platform } from './platforms/Platform';

import { download, downloadFromInfo } from './core/Download';
import { getBasicInfo, getFullInfo } from './core/Info';
import { getHtml5Player } from './core/Info/parser/Html5Player';
import { Agent } from './core/Agent';
import { OAuth2 } from './core/OAuth2';
import { PoToken } from './core/PoToken';

import { Url } from './utils/Url';
import { FormatUtils } from './utils/Format';
import { VERSION } from './utils/Constants';
import { Logger } from './utils/Log';

const FileCache = Platform.getShim().fileCache;

function isNodeVersionOk(version: string): boolean {
    return parseInt(version.replace('v', '').split('.')[0]) >= 16;
}

class YtdlCore {
    public static chooseFormat = FormatUtils.chooseFormat;
    public static filterFormats = FormatUtils.filterFormats;

    public static validateID = Url.validateID;
    public static validateURL = Url.validateURL;
    public static getURLVideoID = Url.getURLVideoID;
    public static getVideoID = Url.getVideoID;

    public static createAgent = Agent.createAgent;
    public static createProxyAgent = Agent.createProxyAgent;

    /* Get Info Options */
    public hl: YTDL_Hreflang = 'en';
    public gl: YTDL_GeoCountry = 'US';
    public requestOptions: any = {};
    public rewriteRequest: YTDL_GetInfoOptions['rewriteRequest'];
    public agent: YTDL_Agent | undefined;
    public poToken: string | undefined;
    public disablePoTokenAutoGeneration: boolean = false;
    public visitorData: string | undefined;
    public includesPlayerAPIResponse: boolean = false;
    public includesNextAPIResponse: boolean = false;
    public includesOriginalFormatData: boolean = false;
    public includesRelatedVideo: boolean = true;
    public clients: Array<YTDL_ClientTypes> | undefined;
    public disableDefaultClients: boolean = false;
    public oauth2: OAuth2 | null = null;
    public parsesHLSFormat: boolean = false;
    public originalProxy: YTDL_GetInfoOptions['originalProxy'];

    /* Format Selection Options */
    public quality: YTDL_ChooseFormatOptions['quality'] | undefined;
    public filter: YTDL_ChooseFormatOptions['filter'] | undefined;
    public excludingClients: Array<YTDL_ClientTypes> = [];
    public includingClients: Array<YTDL_ClientTypes> | 'all' = 'all';

    /* Download Options */
    public range: YTDL_DownloadOptions['range'] | undefined;
    public begin: YTDL_DownloadOptions['begin'] | undefined;
    public liveBuffer: YTDL_DownloadOptions['liveBuffer'] | undefined;
    public highWaterMark: YTDL_DownloadOptions['highWaterMark'] | undefined;
    public IPv6Block: YTDL_DownloadOptions['IPv6Block'] | undefined;
    public dlChunkSize: YTDL_DownloadOptions['dlChunkSize'] | undefined;

    /* Metadata */
    public version = VERSION;

    /* Setup */
    private async setPoToken(poToken?: string) {
        const PO_TOKEN_CACHE = await FileCache.get<string>('poToken');

        if (poToken) {
            this.poToken = poToken;
        } else if (PO_TOKEN_CACHE) {
            Logger.debug('PoToken loaded from cache.');
            this.poToken = PO_TOKEN_CACHE || undefined;
        }

        FileCache.set('poToken', this.poToken || '', { ttl: 60 * 60 * 24 * 365 });
    }

    private async setVisitorData(visitorData?: string) {
        const VISITOR_DATA_CACHE = await FileCache.get<string>('visitorData');

        if (visitorData) {
            this.visitorData = visitorData;
        } else if (VISITOR_DATA_CACHE) {
            Logger.debug('VisitorData loaded from cache.');
            this.visitorData = VISITOR_DATA_CACHE || undefined;
        }

        FileCache.set('visitorData', this.visitorData || '', { ttl: 60 * 60 * 24 * 365 });
    }

    private async setOAuth2(oauth2Credentials: YTDL_OAuth2Credentials | null, proxyOptions: YTDL_ProxyOptions) {
        const OAUTH2_CACHE = (await FileCache.get<YTDL_OAuth2Credentials>('oauth2')) || undefined;

        try {
            if (oauth2Credentials) {
                this.oauth2 = new OAuth2(oauth2Credentials, proxyOptions) || undefined;
            } else if (OAUTH2_CACHE) {
                this.oauth2 = new OAuth2(OAUTH2_CACHE, proxyOptions);
            } else {
                this.oauth2 = null;
            }
        } catch {
            this.oauth2 = null;
        }
    }

    private automaticallyGeneratePoToken() {
        if (!this.poToken && !this.visitorData) {
            Logger.info('Since PoToken and VisitorData are not specified, they are generated automatically.');

            PoToken.generatePoToken()
                .then(({ poToken, visitorData }) => {
                    this.poToken = poToken;
                    this.visitorData = visitorData;

                    FileCache.set('poToken', this.poToken || '', { ttl: 60 * 60 * 24 * 365 });
                    FileCache.set('visitorData', this.visitorData || '', { ttl: 60 * 60 * 24 * 365 });
                })
                .catch(() => {});
        }
    }

    private initializeHtml5PlayerCache() {
        const HTML5_PLAYER = FileCache.get<{ playerUrl: string }>('html5Player');

        if (!HTML5_PLAYER) {
            Logger.debug('To speed up processing, html5Player and signatureTimestamp are pre-fetched and cached.');
            getHtml5Player({});
        }
    }

    constructor({ hl, gl, requestOptions, rewriteRequest, agent, poToken, disablePoTokenAutoGeneration, visitorData, includesPlayerAPIResponse, includesNextAPIResponse, includesOriginalFormatData, includesRelatedVideo, clients, disableDefaultClients, oauth2Credentials, parsesHLSFormat, originalProxy, quality, filter, excludingClients, includingClients, range, begin, liveBuffer, highWaterMark, IPv6Block, dlChunkSize, disableFileCache, logDisplay }: YTDL_Constructor = {}) {
        /* Other Options */
        Logger.logDisplay = logDisplay || ['info', 'success', 'warning', 'error'];
        if (disableFileCache) {
            FileCache.disable();
        }

        /* Get Info Options */
        this.hl = hl || 'en';
        this.gl = gl || 'US';
        this.requestOptions = requestOptions || {};
        this.rewriteRequest = rewriteRequest || undefined;
        this.agent = agent || undefined;
        this.disablePoTokenAutoGeneration = disablePoTokenAutoGeneration ?? false;
        this.includesPlayerAPIResponse = includesPlayerAPIResponse ?? false;
        this.includesNextAPIResponse = includesNextAPIResponse ?? false;
        this.includesOriginalFormatData = includesOriginalFormatData ?? false;
        this.includesRelatedVideo = includesRelatedVideo ?? true;
        this.clients = clients || undefined;
        this.disableDefaultClients = disableDefaultClients ?? false;
        this.parsesHLSFormat = parsesHLSFormat ?? false;

        this.originalProxy = originalProxy || undefined;
        if (this.originalProxy) {
            Logger.debug(`<debug>"${this.originalProxy.base}"</debug> is used for <blue>API requests</blue>.`);
            Logger.debug(`<debug>"${this.originalProxy.download}"</debug> is used for <blue>video downloads</blue>.`);
            Logger.debug(`The query name <debug>"${this.originalProxy.urlQueryName || 'url'}"</debug> is used to specify the URL in the request. <blue>(?url=...)</blue>`);
        }

        this.setPoToken(poToken);
        this.setVisitorData(visitorData);
        this.setOAuth2(oauth2Credentials || null, {
            agent: this.agent,
            rewriteRequest: this.rewriteRequest,
            originalProxy: this.originalProxy,
        });

        /* Format Selection Options */
        this.quality = quality || undefined;
        this.filter = filter || undefined;
        this.excludingClients = excludingClients || [];
        this.includingClients = includingClients || 'all';

        /* Download Options */
        this.range = range || undefined;
        this.begin = begin || undefined;
        this.liveBuffer = liveBuffer || undefined;
        this.highWaterMark = highWaterMark || undefined;
        this.IPv6Block = IPv6Block || undefined;
        this.dlChunkSize = dlChunkSize || undefined;

        if (!this.disablePoTokenAutoGeneration) {
            this.automaticallyGeneratePoToken();
        }
        this.initializeHtml5PlayerCache();

        /* Version Check */
        if (!isNodeVersionOk(process.version)) {
            throw new Error(`You are using Node.js ${process.version} which is not supported. Minimum version required is v16.`);
        }
    }

    private initializeOptions(options: YTDL_DownloadOptions): InternalDownloadOptions {
        const INTERNAL_OPTIONS: InternalDownloadOptions = { ...options, oauth2: this.oauth2 };

        INTERNAL_OPTIONS.hl = options.hl || this.hl;
        INTERNAL_OPTIONS.gl = options.gl || this.gl;
        INTERNAL_OPTIONS.requestOptions = options.requestOptions || this.requestOptions;
        INTERNAL_OPTIONS.rewriteRequest = options.rewriteRequest || this.rewriteRequest;
        INTERNAL_OPTIONS.agent = options.agent || this.agent;
        INTERNAL_OPTIONS.poToken = options.poToken || this.poToken;
        INTERNAL_OPTIONS.disablePoTokenAutoGeneration = options.disablePoTokenAutoGeneration || this.disablePoTokenAutoGeneration;
        INTERNAL_OPTIONS.visitorData = options.visitorData || this.visitorData;
        INTERNAL_OPTIONS.includesPlayerAPIResponse = options.includesPlayerAPIResponse || this.includesPlayerAPIResponse;
        INTERNAL_OPTIONS.includesNextAPIResponse = options.includesNextAPIResponse || this.includesNextAPIResponse;
        INTERNAL_OPTIONS.includesOriginalFormatData = options.includesOriginalFormatData || this.includesOriginalFormatData;
        INTERNAL_OPTIONS.includesRelatedVideo = options.includesRelatedVideo || this.includesRelatedVideo;
        INTERNAL_OPTIONS.clients = options.clients || this.clients;
        INTERNAL_OPTIONS.disableDefaultClients = options.disableDefaultClients || this.disableDefaultClients;
        INTERNAL_OPTIONS.oauth2Credentials = options.oauth2Credentials || this.oauth2?.getCredentials();
        INTERNAL_OPTIONS.parsesHLSFormat = options.parsesHLSFormat || this.parsesHLSFormat;
        INTERNAL_OPTIONS.originalProxy = options.originalProxy || this.originalProxy || undefined;

        /* Format Selection Options */
        INTERNAL_OPTIONS.quality = options.quality || this.quality || undefined;
        INTERNAL_OPTIONS.filter = options.filter || this.filter || undefined;
        INTERNAL_OPTIONS.excludingClients = options.excludingClients || this.excludingClients || [];
        INTERNAL_OPTIONS.includingClients = options.includingClients || this.includingClients || 'all';

        /* Download Options */
        INTERNAL_OPTIONS.range = options.range || this.range || undefined;
        INTERNAL_OPTIONS.begin = options.begin || this.begin || undefined;
        INTERNAL_OPTIONS.liveBuffer = options.liveBuffer || this.liveBuffer || undefined;
        INTERNAL_OPTIONS.highWaterMark = options.highWaterMark || this.highWaterMark || undefined;
        INTERNAL_OPTIONS.IPv6Block = options.IPv6Block || this.IPv6Block || undefined;
        INTERNAL_OPTIONS.dlChunkSize = options.dlChunkSize || this.dlChunkSize || undefined;

        if (!INTERNAL_OPTIONS.oauth2 && options.oauth2Credentials) {
            Logger.warning('The OAuth2 token should be specified when instantiating the YtdlCore class, not as a function argument.');

            INTERNAL_OPTIONS.oauth2 = new OAuth2(options.oauth2Credentials, {
                agent: INTERNAL_OPTIONS.agent,
                rewriteRequest: INTERNAL_OPTIONS.rewriteRequest,
                originalProxy: INTERNAL_OPTIONS.originalProxy,
            });
        }

        return INTERNAL_OPTIONS;
    }

    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.) */
    public download(link: string, options: YTDL_DownloadOptions = {}) {
        return download(link, this.initializeOptions(options));
    }
    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.) */
    public downloadFromInfo(info: YTDL_VideoInfo, options: YTDL_DownloadOptions = {}) {
        return downloadFromInfo(info, this.initializeOptions(options));
    }

    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.) */
    public getBasicInfo(link: string, options: YTDL_DownloadOptions = {}) {
        return getBasicInfo(link, this.initializeOptions(options));
    }
    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.) */
    public getFullInfo(link: string, options: YTDL_DownloadOptions = {}) {
        return getFullInfo(link, this.initializeOptions(options));
    }
}

export { YtdlCore };
