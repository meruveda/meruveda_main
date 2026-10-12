"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSnakeCase = exports.toCamelCase = exports.slugify = exports.formatFileSize = exports.formatNumber = exports.formatDateTime = exports.formatDate = exports.formatCurrency = void 0;
const date_fns_1 = require("date-fns");
const CURRENCY_SYMBOL = '₹'; // Assuming from admin config
const formatCurrency = (amount = 0) => {
    const validAmount = Number(amount) || 0;
    return `${CURRENCY_SYMBOL}${validAmount.toLocaleString('en-IN', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
    })}`;
};
exports.formatCurrency = formatCurrency;
const formatDate = (dateString) => {
    if (!dateString)
        return '-';
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (isNaN(date.getTime()))
        return '-';
    return (0, date_fns_1.format)(date, 'dd MMM yyyy');
};
exports.formatDate = formatDate;
const formatDateTime = (dateString) => {
    if (!dateString)
        return '-';
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    if (isNaN(date.getTime()))
        return '-';
    return (0, date_fns_1.format)(date, 'dd MMM yyyy, hh:mm a');
};
exports.formatDateTime = formatDateTime;
const formatNumber = (num) => {
    return num.toLocaleString('en-IN');
};
exports.formatNumber = formatNumber;
const formatFileSize = (bytes) => {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
exports.formatFileSize = formatFileSize;
const slugify = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/[^\w\-]+/g, '') // Remove all non-word chars
        .replace(/\-\-+/g, '-') // Replace multiple - with single -
        .replace(/^-+/, '') // Trim - from start
        .replace(/-+$/, ''); // Trim - from end
};
exports.slugify = slugify;
const toCamelCase = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(v => (0, exports.toCamelCase)(v));
    }
    else if (obj !== null && obj.constructor === Object) {
        return Object.keys(obj).reduce((result, key) => {
            const camelKey = key.replace(/_([a-z])/g, g => g[1].toUpperCase());
            result[camelKey] = (0, exports.toCamelCase)(obj[key]);
            return result;
        }, {});
    }
    return obj;
};
exports.toCamelCase = toCamelCase;
const toSnakeCase = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(v => (0, exports.toSnakeCase)(v));
    }
    else if (obj !== null && obj.constructor === Object) {
        return Object.keys(obj).reduce((result, key) => {
            const snakeKey = key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
            result[snakeKey] = (0, exports.toSnakeCase)(obj[key]);
            return result;
        }, {});
    }
    return obj;
};
exports.toSnakeCase = toSnakeCase;
