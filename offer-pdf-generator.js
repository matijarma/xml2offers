'use strict';

(function attachOfferPdfGenerator(globalScope) {
    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const COVER_BAND_HEIGHT = 86;
    const RUNNING_HEADER_HEIGHT = 28;

    function asNumber(value, fallback = 0) {
        if (value === null || value === undefined || value === '') return fallback;
        const normalized = Number(String(value).replace(',', '.'));
        return Number.isFinite(normalized) ? normalized : fallback;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function roundMoney(value) {
        return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
    }

    function normalizeItems(items, fallbackDiscountRate = 0) {
        if (!Array.isArray(items)) return [];
        return items
            .map((item) => {
                const quantity = asNumber(item && (item.quantity ?? item.qty), 0);
                const unitPrice = asNumber(item && item.unitPrice, 0);
                const description = String(item && item.description ? item.description : '').trim();
                const unit = String(item && item.unit ? item.unit : '').trim();
                const lineGross = roundMoney(quantity * unitPrice);
                const rawDiscountRate = item && item.discountRate !== undefined
                    ? item.discountRate
                    : fallbackDiscountRate;
                const discountRate = clamp(asNumber(rawDiscountRate, 0), 0, 100);
                const discountAmount = roundMoney(lineGross * (discountRate / 100));
                const lineTotal = roundMoney(lineGross - discountAmount);
                return {
                    description,
                    quantity: roundMoney(quantity),
                    unit,
                    unitPrice: roundMoney(unitPrice),
                    discountRate: roundMoney(discountRate),
                    lineGross,
                    discountAmount,
                    lineTotal
                };
            })
            .filter((item) => item.description || item.quantity || item.unitPrice);
    }

    function computeOfferTotals(items, discountRateOrVatRate, vatRateMaybe) {
        const usingLegacyGlobalDiscount = vatRateMaybe !== undefined && vatRateMaybe !== null;
        const fallbackDiscountRate = usingLegacyGlobalDiscount
            ? clamp(asNumber(discountRateOrVatRate, 0), 0, 100)
            : 0;
        const normalizedItems = normalizeItems(items, fallbackDiscountRate);
        const standardPrice = roundMoney(
            normalizedItems.reduce((sum, item) => sum + roundMoney(item.lineGross), 0)
        );
        const normalizedVatRate = clamp(
            asNumber(usingLegacyGlobalDiscount ? vatRateMaybe : discountRateOrVatRate, 25),
            0,
            99.99
        );
        const discountAmount = roundMoney(
            normalizedItems.reduce((sum, item) => sum + roundMoney(item.discountAmount), 0)
        );
        const netBase = roundMoney(standardPrice - discountAmount);
        const vatAmount = roundMoney(netBase * (normalizedVatRate / 100));
        const total = roundMoney(netBase + vatAmount);

        return {
            items: normalizedItems,
            discountRate: fallbackDiscountRate,
            vatRate: normalizedVatRate,
            standardPrice,
            discountAmount,
            netBase,
            vatAmount,
            total
        };
    }

    function formatCurrency(value, currency, locale) {
        const amount = roundMoney(value);
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency || 'EUR',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        } catch (error) {
            const fallback = amount.toFixed(2).replace('.', ',');
            return `${fallback} ${currency || 'EUR'}`;
        }
    }

    function formatNumber(value, locale, fractionDigits) {
        const amount = asNumber(value);
        const digits = fractionDigits === undefined ? 2 : fractionDigits;
        try {
            return new Intl.NumberFormat(locale, {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            }).format(amount);
        } catch (error) {
            return amount.toFixed(digits);
        }
    }

    function formatDate(value, locale) {
        if (!value) return '-';
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        try {
            return new Intl.DateTimeFormat(locale, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(date);
        } catch (error) {
            return date.toISOString().slice(0, 10);
        }
    }

    function hexToRgb(hexColor) {
        if (!hexColor || typeof hexColor !== 'string') return [44, 62, 80];
        const value = hexColor.trim().replace('#', '');
        if (value.length === 3) {
            const r = Number.parseInt(value[0] + value[0], 16);
            const g = Number.parseInt(value[1] + value[1], 16);
            const b = Number.parseInt(value[2] + value[2], 16);
            if ([r, g, b].every(Number.isFinite)) return [r, g, b];
            return [44, 62, 80];
        }
        if (value.length === 6) {
            const r = Number.parseInt(value.slice(0, 2), 16);
            const g = Number.parseInt(value.slice(2, 4), 16);
            const b = Number.parseInt(value.slice(4, 6), 16);
            if ([r, g, b].every(Number.isFinite)) return [r, g, b];
        }
        return [44, 62, 80];
    }

    function normalizeHex(hexColor) {
        const rgb = hexToRgb(hexColor);
        return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
    }

    function relativeLuminance(rgb) {
        const channel = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }

    function pickOnAccent(accentRgb) {
        return relativeLuminance(accentRgb) < 0.55 ? '#ffffff' : '#1f2937';
    }

    function isImageDataUrl(value) {
        return typeof value === 'string' && /^data:image\/(png|jpe?g|webp|gif|svg\+xml)/i.test(value);
    }

    function createI18n(messages, locale) {
        const dictionary = messages || {};
        const isEnglish = String(locale || '').toLowerCase().startsWith('en');
        const fallbacks = {
            offerPdfTitle: isEnglish ? 'OFFER' : 'PONUDA',
            offerPdfIssuerLabel: isEnglish ? 'ISSUER' : 'IZDAVATELJ',
            offerPdfCustomerLabel: isEnglish ? 'CUSTOMER' : 'KLIJENT',
            offerPdfMetaNumber: isEnglish ? 'Offer number' : 'Broj ponude',
            offerPdfMetaIssueDate: isEnglish ? 'Issue date' : 'Datum izdavanja',
            offerPdfMetaValidUntil: isEnglish ? 'Valid until' : 'Rok valjanosti',
            offerPdfIntroLabel: isEnglish ? 'Intro' : 'Uvod',
            offerPdfSpecificationLabel: isEnglish ? 'Specification' : 'Specifikacija',
            offerPdfTableNo: '#',
            offerPdfTableDescription: isEnglish ? 'Description' : 'Opis',
            offerPdfTableQuantity: isEnglish ? 'Qty' : 'Kol.',
            offerPdfTableUnit: isEnglish ? 'Unit' : 'JM',
            offerPdfTableUnitPrice: isEnglish ? 'Unit price' : 'Jed. cijena',
            offerPdfTableDiscount: isEnglish ? 'Discount' : 'Popust',
            offerPdfTableTotal: isEnglish ? 'Total' : 'Ukupno',
            offerSummaryStandard: isEnglish ? 'Standard price' : 'Standardna cijena',
            offerSummaryDiscount: isEnglish ? 'Discount' : 'Popust',
            offerSummaryNet: isEnglish ? 'Net base' : 'Neto osnovica',
            offerSummaryVat: isEnglish ? 'VAT' : 'PDV',
            offerSummaryTotal: isEnglish ? 'Total to pay' : 'Ukupno za platiti',
            offerPdfNoteLabel: isEnglish ? 'Note' : 'Napomena',
            offerPdfFooterPage: isEnglish ? 'Page' : 'Stranica'
        };
        return function i18n(key, substitutions) {
            const template = dictionary[key] && dictionary[key].message ? dictionary[key].message : fallbacks[key] || key;
            if (!Array.isArray(substitutions) || substitutions.length === 0) return template;
            return template.replace(/\$(\d+)/g, (match, index) => {
                const replacement = substitutions[Number(index) - 1];
                return replacement === undefined ? '' : replacement;
            });
        };
    }

    function toLineList(parts) {
        if (!Array.isArray(parts)) return [];
        return parts
            .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
            .filter(Boolean);
    }

    function splitParagraphs(text) {
        if (!text) return [];
        return String(text)
            .replace(/\r\n/g, '\n')
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean);
    }

    function makeTokens(accentHex, compact) {
        const accentRgb = hexToRgb(accentHex);
        const accent = normalizeHex(accentHex);
        const onAccent = pickOnAccent(accentRgb);
        return {
            accent,
            accentSoft: accent + '15',
            onAccent,
            ink: '#1f2937',
            body: '#38475e',
            muted: '#6b7785',
            rule: '#d8dee6',
            surface: '#f7f9fc',
            white: '#ffffff',
            bodyFont: compact ? 9 : 10,
            bodyLeading: compact ? 1.25 : 1.4,
            labelFont: 8,
            sectionGap: compact ? 10 : 16,
            paragraphGap: compact ? 3 : 5,
            tableFont: compact ? 8.5 : 9,
            tablePadV: compact ? 3 : 5,
            tablePadH: 6,
            cardPad: compact ? 8 : 11
        };
    }

    function buildCoverHeader(data, tokens, opts, i18n, locale, logoDataUrl) {
        const title = i18n('offerPdfTitle');
        const offerNumber = data.offerNumber || '-';
        const issueDate = formatDate(data.issueDate, locale);
        const validUntil = formatDate(data.validUntil, locale);

        const titleStack = [
            {
                text: title,
                color: tokens.onAccent,
                fontSize: 28,
                bold: true,
                characterSpacing: 1.5,
                margin: [0, 0, 0, 4]
            },
            {
                canvas: [
                    { type: 'rect', x: 0, y: 0, w: 36, h: 2, color: tokens.onAccent }
                ],
                margin: [0, 0, 0, 0]
            }
        ];

        const titleColumn = { stack: titleStack, width: '*' };

        if (logoDataUrl && isImageDataUrl(logoDataUrl)) {
            try {
                titleColumn.stack = [
                    {
                        columns: [
                            { image: logoDataUrl, fit: [44, 36], width: 44 },
                            { stack: titleStack, margin: [10, 0, 0, 0] }
                        ],
                        columnGap: 0
                    }
                ];
            } catch (error) {
                // fall back to text-only title
            }
        }

        const metaLines = [
            { label: i18n('offerPdfMetaNumber'), value: offerNumber },
            { label: i18n('offerPdfMetaIssueDate'), value: issueDate },
            { label: i18n('offerPdfMetaValidUntil'), value: validUntil }
        ];

        const metaColumn = {
            width: 200,
            stack: metaLines.map((line) => ({
                columns: [
                    {
                        text: line.label.toUpperCase(),
                        color: tokens.onAccent,
                        opacity: 0.75,
                        fontSize: 7.5,
                        characterSpacing: 0.6,
                        width: 'auto'
                    },
                    {
                        text: line.value,
                        color: tokens.onAccent,
                        fontSize: 10,
                        bold: true,
                        alignment: 'right',
                        width: '*'
                    }
                ],
                margin: [0, 0, 0, 3]
            }))
        };

        return {
            margin: [36, 22, 36, 0],
            columns: [titleColumn, metaColumn],
            columnGap: 24
        };
    }

    function buildRunningHeader(data, tokens, i18n) {
        const customerName = (data.customer && data.customer.name) ? String(data.customer.name).trim() : '';
        const offerNumber = data.offerNumber || '';
        const parts = [
            i18n('offerPdfTitle'),
            offerNumber ? `#${offerNumber}` : '',
            customerName
        ].filter(Boolean);
        return {
            margin: [36, 8, 36, 0],
            text: parts.join('  ·  '),
            color: tokens.onAccent,
            fontSize: 9,
            characterSpacing: 0.4,
            bold: true
        };
    }

    function buildFooter(data, tokens, i18n) {
        const issuerName = (data.issuer && data.issuer.name) ? String(data.issuer.name).trim() : '';
        const issuerOib = (data.issuer && data.issuer.oib) ? `OIB ${String(data.issuer.oib).trim()}` : '';
        const offerNumber = data.offerNumber || '';
        const leftText = [issuerName, issuerOib].filter(Boolean).join('  ·  ');

        return function footerFn(currentPage, pageCount) {
            return {
                margin: [36, 16, 36, 0],
                stack: [
                    {
                        canvas: [
                            { type: 'line', x1: 0, y1: 0, x2: PAGE_WIDTH - 72, y2: 0, lineWidth: 0.5, lineColor: tokens.rule }
                        ]
                    },
                    {
                        columns: [
                            {
                                text: leftText || ' ',
                                color: tokens.muted,
                                fontSize: 8,
                                width: '*'
                            },
                            {
                                text: `${i18n('offerPdfFooterPage')} ${currentPage} / ${pageCount}${offerNumber ? '  ·  ' + offerNumber : ''}`,
                                color: tokens.muted,
                                fontSize: 8,
                                alignment: 'right',
                                width: 'auto'
                            }
                        ],
                        margin: [0, 6, 0, 0]
                    }
                ]
            };
        };
    }

    function joinSingleLine(parts) {
        return parts
            .map((part) => (part === null || part === undefined ? '' : String(part).replace(/\s*[\r\n]+\s*/g, ' ').trim()))
            .filter(Boolean)
            .join(', ');
    }

    function buildPartiesBlock(data, tokens, i18n) {
        const issuer = data.issuer || {};
        const customer = data.customer || {};
        const issuerAddressLine = joinSingleLine([issuer.address, issuer.city]);
        const customerAddressLine = joinSingleLine([customer.address]);

        const issuerBody = toLineList([
            issuer.name,
            issuerAddressLine,
            issuer.oib ? `OIB: ${issuer.oib}` : '',
            issuer.iban ? `IBAN: ${issuer.iban}` : '',
            issuer.email,
            issuer.web
        ]);
        const customerBody = toLineList([
            customer.name,
            customerAddressLine,
            customer.oib ? `OIB: ${customer.oib}` : ''
        ]);

        function card(label, lines, accentSide) {
            return {
                table: {
                    widths: ['*'],
                    body: [[
                        {
                            stack: [
                                {
                                    text: label.toUpperCase(),
                                    fontSize: 7.5,
                                    characterSpacing: 1,
                                    color: tokens.accent,
                                    bold: true,
                                    margin: [0, 0, 0, 6]
                                },
                                lines.length === 0
                                    ? { text: '—', color: tokens.muted, fontSize: tokens.bodyFont }
                                    : {
                                        stack: lines.map((ln, i) => ({
                                            text: ln,
                                            color: i === 0 ? tokens.ink : tokens.body,
                                            fontSize: i === 0 ? tokens.bodyFont + 1 : tokens.bodyFont,
                                            bold: i === 0,
                                            margin: [0, i === 0 ? 0 : 1, 0, 0]
                                        }))
                                    }
                            ],
                            border: [false, false, false, false],
                            fillColor: tokens.surface,
                            margin: [tokens.cardPad, tokens.cardPad, tokens.cardPad, tokens.cardPad]
                        }
                    ]]
                },
                layout: {
                    defaultBorder: false,
                    paddingLeft: () => 0,
                    paddingRight: () => 0,
                    paddingTop: () => 0,
                    paddingBottom: () => 0
                },
                unbreakable: true
            };
        }

        const accentStripe = (color) => ({
            canvas: [{ type: 'rect', x: 0, y: 0, w: 3, h: 60, color: color }],
            width: 3
        });

        return {
            columns: [
                {
                    width: '*',
                    stack: [
                        { canvas: [{ type: 'rect', x: 0, y: 0, w: 24, h: 2, color: tokens.accent }], margin: [0, 0, 0, 6] },
                        card(i18n('offerPdfIssuerLabel'), issuerBody, tokens.accent)
                    ]
                },
                {
                    width: '*',
                    stack: [
                        { canvas: [{ type: 'rect', x: 0, y: 0, w: 24, h: 2, color: tokens.accent }], margin: [0, 0, 0, 6] },
                        card(i18n('offerPdfCustomerLabel'), customerBody, tokens.accent)
                    ]
                }
            ],
            columnGap: 16,
            margin: [0, 0, 0, tokens.sectionGap]
        };
    }

    function buildTextSection(label, text, tokens) {
        const paragraphs = splitParagraphs(text);
        if (paragraphs.length === 0) return null;
        const labelBlock = {
            stack: [
                {
                    text: label.toUpperCase(),
                    fontSize: 8,
                    characterSpacing: 1.2,
                    color: tokens.accent,
                    bold: true,
                    margin: [0, 0, 0, 4]
                },
                {
                    canvas: [{ type: 'rect', x: 0, y: 0, w: 18, h: 1.6, color: tokens.accent }],
                    margin: [0, 0, 0, 8]
                }
            ]
        };
        const paragraphBlocks = paragraphs.map((p, i) => ({
            text: p,
            color: tokens.body,
            fontSize: tokens.bodyFont,
            lineHeight: tokens.bodyLeading,
            margin: [0, i === 0 ? 0 : tokens.paragraphGap, 0, 0]
        }));

        const headerStack = {
            stack: [labelBlock, paragraphBlocks[0]],
            unbreakable: true
        };
        const rest = paragraphBlocks.slice(1);
        return {
            stack: [headerStack, ...rest],
            margin: [0, 0, 0, tokens.sectionGap]
        };
    }

    function buildItemsTable(totals, tokens, currency, locale, i18n) {
        const items = totals.items || [];
        const hasAnyDiscount = items.some((it) => it.discountRate > 0);

        const headerCells = [
            { text: i18n('offerPdfTableNo'), alignment: 'center' },
            { text: i18n('offerPdfTableDescription'), alignment: 'left' },
            { text: i18n('offerPdfTableQuantity'), alignment: 'right' },
            { text: i18n('offerPdfTableUnit'), alignment: 'left' },
            { text: i18n('offerPdfTableUnitPrice'), alignment: 'right' }
        ];
        if (hasAnyDiscount) headerCells.push({ text: i18n('offerPdfTableDiscount'), alignment: 'right' });
        headerCells.push({ text: i18n('offerPdfTableTotal'), alignment: 'right' });

        const headerRow = headerCells.map((cell) => ({
            text: cell.text,
            alignment: cell.alignment,
            color: tokens.onAccent,
            bold: true,
            fontSize: tokens.tableFont,
            characterSpacing: 0.3
        }));

        const widths = hasAnyDiscount
            ? [22, '*', 44, 44, 70, 44, 78]
            : [22, '*', 50, 50, 80, 90];

        const bodyRows = items.map((item, index) => {
            const row = [
                { text: String(index + 1), alignment: 'center', color: tokens.muted, fontSize: tokens.tableFont },
                { text: item.description || '—', alignment: 'left', color: tokens.ink, fontSize: tokens.tableFont },
                { text: formatNumber(item.quantity, locale, 2), alignment: 'right', color: tokens.ink, fontSize: tokens.tableFont },
                { text: item.unit || '—', alignment: 'left', color: tokens.body, fontSize: tokens.tableFont },
                { text: formatCurrency(item.unitPrice, currency, locale), alignment: 'right', color: tokens.ink, fontSize: tokens.tableFont }
            ];
            if (hasAnyDiscount) {
                row.push({
                    text: item.discountRate > 0 ? `${formatNumber(item.discountRate, locale, item.discountRate % 1 === 0 ? 0 : 2)}%` : '—',
                    alignment: 'right',
                    color: item.discountRate > 0 ? tokens.ink : tokens.muted,
                    fontSize: tokens.tableFont
                });
            }
            row.push({ text: formatCurrency(item.lineTotal, currency, locale), alignment: 'right', color: tokens.ink, bold: true, fontSize: tokens.tableFont });
            return row;
        });

        return {
            table: {
                headerRows: 1,
                keepWithHeaderRows: 1,
                dontBreakRows: true,
                widths: widths,
                body: [headerRow, ...bodyRows]
            },
            layout: {
                hLineWidth: (i) => (i === 0 || i === 1 ? 0 : 0.5),
                vLineWidth: () => 0,
                hLineColor: () => tokens.rule,
                fillColor: (rowIndex) => {
                    if (rowIndex === 0) return tokens.accent;
                    return rowIndex % 2 === 0 ? tokens.surface : null;
                },
                paddingLeft: () => tokens.tablePadH,
                paddingRight: () => tokens.tablePadH,
                paddingTop: (i) => (i === 0 ? tokens.tablePadV + 2 : tokens.tablePadV),
                paddingBottom: (i) => (i === 0 ? tokens.tablePadV + 2 : tokens.tablePadV)
            },
            margin: [0, 0, 0, tokens.sectionGap]
        };
    }

    function buildSummary(totals, tokens, currency, locale, i18n) {
        const rows = [
            { label: i18n('offerSummaryStandard'), value: formatCurrency(totals.standardPrice, currency, locale) },
            { label: i18n('offerSummaryDiscount'), value: formatCurrency(totals.discountAmount, currency, locale) },
            { label: i18n('offerSummaryNet'), value: formatCurrency(totals.netBase, currency, locale) },
            { label: i18n('offerSummaryVat'), value: formatCurrency(totals.vatAmount, currency, locale) }
        ];

        const summaryRows = rows.map((r) => [
            { text: r.label, color: tokens.body, fontSize: tokens.bodyFont, margin: [0, 3, 0, 3] },
            { text: r.value, color: tokens.ink, fontSize: tokens.bodyFont, alignment: 'right', margin: [0, 3, 0, 3] }
        ]);

        summaryRows.push([
            {
                text: i18n('offerSummaryTotal').toUpperCase(),
                color: tokens.muted,
                fontSize: 8.5,
                characterSpacing: 1,
                bold: true,
                margin: [0, 8, 0, 6]
            },
            {
                text: formatCurrency(totals.total, currency, locale),
                color: tokens.accent,
                fontSize: 16,
                bold: true,
                alignment: 'right',
                margin: [0, 4, 0, 6]
            }
        ]);

        return {
            unbreakable: true,
            margin: [0, 0, 0, tokens.sectionGap],
            columns: [
                { text: '', width: '*' },
                {
                    width: 230,
                    table: {
                        widths: ['*', 'auto'],
                        body: summaryRows
                    },
                    layout: {
                        defaultBorder: false,
                        hLineWidth: (i, node) => (i === node.table.body.length - 1 ? 0.8 : 0),
                        hLineColor: () => tokens.rule,
                        vLineWidth: () => 0,
                        paddingLeft: () => 12,
                        paddingRight: () => 12,
                        paddingTop: () => 0,
                        paddingBottom: () => 0,
                        fillColor: () => null
                    }
                }
            ]
        };
    }

    function buildDocDefinition(data, opts, totals, compact) {
        const locale = opts.locale || 'hr-HR';
        const accentColor = opts.accentColor || '#c10034';
        const logoDataUrl = opts.logoDataUrl || '';
        const currency = data.currency || 'EUR';
        const i18n = createI18n(opts.messages || {}, locale);
        const tokens = makeTokens(accentColor, !!compact);

        const topMargin = COVER_BAND_HEIGHT + 18;
        const topMarginPage2 = RUNNING_HEADER_HEIGHT + 14;

        const partiesBlock = buildPartiesBlock(data, tokens, i18n);
        const introBlock = buildTextSection(i18n('offerPdfIntroLabel'), data.intro, tokens);
        const specBlock = buildTextSection(i18n('offerPdfSpecificationLabel'), data.specification, tokens);
        const tableBlock = buildItemsTable(totals, tokens, currency, locale, i18n);
        const summaryBlock = buildSummary(totals, tokens, currency, locale, i18n);
        const noteBlock = buildTextSection(i18n('offerPdfNoteLabel'), data.note, tokens);

        const summaryAndNote = noteBlock
            ? { stack: [summaryBlock, noteBlock], unbreakable: true }
            : summaryBlock;

        const content = [partiesBlock];
        if (introBlock) content.push(introBlock);
        if (specBlock) content.push(specBlock);
        content.push(tableBlock);
        content.push(summaryAndNote);

        const coverHeader = buildCoverHeader(data, tokens, opts, i18n, locale, logoDataUrl);
        const runningHeader = buildRunningHeader(data, tokens, i18n);
        const footerFn = buildFooter(data, tokens, i18n);

        return {
            pageSize: 'A4',
            pageMargins: [36, topMargin, 36, 56],
            background: function background(currentPage) {
                if (currentPage === 1) {
                    return [
                        {
                            canvas: [
                                { type: 'rect', x: 0, y: 0, w: PAGE_WIDTH, h: COVER_BAND_HEIGHT, color: tokens.accent }
                            ]
                        }
                    ];
                }
                return [
                    {
                        canvas: [
                            { type: 'rect', x: 0, y: 0, w: PAGE_WIDTH, h: RUNNING_HEADER_HEIGHT, color: tokens.accent },
                            { type: 'rect', x: 0, y: RUNNING_HEADER_HEIGHT, w: PAGE_WIDTH, h: 1.5, color: tokens.accent }
                        ]
                    }
                ];
            },
            header: function header(currentPage) {
                if (currentPage === 1) return coverHeader;
                return runningHeader;
            },
            footer: footerFn,
            content: content,
            defaultStyle: {
                font: 'Roboto',
                fontSize: tokens.bodyFont,
                color: tokens.body,
                lineHeight: tokens.bodyLeading
            }
        };
    }

    function renderToBlob(docDef) {
        return new Promise((resolve, reject) => {
            try {
                const pdfMake = globalScope.pdfMake;
                if (!pdfMake || typeof pdfMake.createPdf !== 'function') {
                    throw new Error('pdfMake is not loaded.');
                }
                let pageCount = 0;
                const wrapped = Object.assign({}, docDef, {
                    footer: function wrappedFooter(currentPage, total) {
                        if (typeof total === 'number') pageCount = Math.max(pageCount, total);
                        return docDef.footer(currentPage, total);
                    }
                });
                pdfMake.createPdf(wrapped).getBlob((blob) => {
                    resolve({ blob, pageCount });
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async function createOfferPdf(offerData, options) {
        const data = offerData || {};
        const opts = options || {};

        const hasPerItemDiscount = Array.isArray(data.items) && data.items.some((item) =>
            item && item.discountRate !== undefined && item.discountRate !== null && item.discountRate !== ''
        );
        const totals = hasPerItemDiscount
            ? computeOfferTotals(data.items || [], data.vatRate)
            : computeOfferTotals(data.items || [], data.discountRate, data.vatRate);

        const passOneDef = buildDocDefinition(data, opts, totals, false);
        const passOne = await renderToBlob(passOneDef);

        if (passOne.pageCount <= 1) {
            return { blob: passOne.blob, totals, pageCount: passOne.pageCount };
        }

        const compactDef = buildDocDefinition(data, opts, totals, true);
        const compactPass = await renderToBlob(compactDef);

        if (compactPass.pageCount < passOne.pageCount) {
            return { blob: compactPass.blob, totals, pageCount: compactPass.pageCount };
        }
        return { blob: passOne.blob, totals, pageCount: passOne.pageCount };
    }

    globalScope.OfferPdfGenerator = {
        computeOfferTotals,
        createOfferPdf
    };
}(window));
