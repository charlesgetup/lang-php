import {NodeWeakMap, SyntaxNodeRef, SyntaxNode, IterMode} from "@lezer/common"
import {Completion, CompletionContext, CompletionResult, completeFromList, ifNotIn,
        snippetCompletion as snip} from "@codemirror/autocomplete"
import {syntaxTree} from "@codemirror/language"
import {Text} from "@codemirror/state"

const cache = new NodeWeakMap<readonly Completion[]>()

const ScopeNodes = new Set([
  "Script", "Body",
  "FunctionDefinition", "ClassDefinition", "LambdaExpression",
  "ForStatement"
])

function defID(type: string) {
  return (node: SyntaxNodeRef, def: (node: SyntaxNodeRef, type: string) => void) => {
    let id = node.node.getChild("VariableName")
    if (id) def(id, type)
    return true
  }
}

const gatherCompletions: {
  [node: string]: (node: SyntaxNodeRef, def: (node: SyntaxNodeRef, type: string) => void) => void | boolean
} = {
  FunctionDefinition: defID("function"),
  ClassDefinition: defID("class"),
  __proto__: null as any
}

function getScope(doc: Text, node: SyntaxNode) {
  let cached = cache.get(node)
  if (cached) return cached

  let completions: Completion[] = [], top = true
  function def(node: SyntaxNodeRef, type: string) {
    let name = doc.sliceString(node.from, node.to)
    completions.push({label: name, type})
  }
  node.cursor(IterMode.IncludeAnonymous).iterate(node => {
    if (top) {
      top = false
    } else if (node.name) {
      let gather = gatherCompletions[node.name]
      if (gather && gather(node, def) || !top && ScopeNodes.has(node.name)) return false
    } else if (node.to - node.from > 8192) {
      // Allow caching for bigger internal nodes
      for (let c of getScope(doc, node.node)) completions.push(c)
      return false
    }
  })
  cache.set(node, completions)
  return completions
}

const Identifier = /^[\w\xa1-\uffff][\w\d\xa1-\uffff]*$/

const dontComplete = ["String", "FormatString", "Comment", "PropertyName"]

/// Completion source that looks up locally defined names in
/// PHP code.
export function localCompletionSource(context: CompletionContext): CompletionResult | null {
  let inner = syntaxTree(context.state).resolveInner(context.pos, -1)
  if (dontComplete.indexOf(inner.name) > -1) return null
  let isWord = inner.name == "VariableName" ||
    inner.to - inner.from < 20 && Identifier.test(context.state.sliceDoc(inner.from, inner.to))
  if (!isWord && !context.explicit) return null
  let options: Completion[] = []
  for (let pos: SyntaxNode | null = inner; pos; pos = pos.parent) {
    if (ScopeNodes.has(pos.name)) options = options.concat(getScope(context.state.doc, pos))
  }
  return {
    options,
    from: isWord ? inner.from : context.pos,
    validFor: Identifier
  }
}

const globals: readonly Completion[] = [
  "$GLOBALS", "$_SERVER", "$_GET", "$_POST", "$_FILES", "$_COOKIE", "$_SESSION", "$_REQUEST", "$_ENV"
].map(n => ({label: n, type: "superglobals"})).concat([
  "__LINE__", "__FILE__", "__DIR__", "__FUNCTION__", "__CLASS__", "__TRAIT__", "__METHOD__", 
  "__NAMESPACE__", "ClassName::class", "DIRECTORY_SEPARATOR", "PATH_SEPARATOR", "SCANDIR_SORT_ASCENDING", 
  "SCANDIR_SORT_DESCENDING", "SCANDIR_SORT_NONE", "E_ERROR", "E_WARNING", "E_PARSE", "E_NOTICE", "E_CORE_ERROR", 
  "E_CORE_WARNING", "E_COMPILE_ERROR", "E_COMPILE_WARNING", "E_USER_ERROR", "E_USER_WARNING", "E_USER_NOTICE", 
  "E_STRICT", "E_RECOVERABLE_ERROR", "E_DEPRECATED", "E_USER_DEPRECATED", "E_ALL", "CASE_LOWER", "CASE_UPPER", 
  "SORT_ASC", "SORT_DESC", "SORT_REGULAR", "SORT_NUMERIC", "SORT_STRING", "SORT_LOCALE_STRING", "SORT_NATURAL", 
  "SORT_FLAG_CASE", "ARRAY_FILTER_USE_KEY", "ARRAY_FILTER_USE_BOTH", "COUNT_NORMAL", "COUNT_RECURSIVE", "EXTR_OVERWRITE", 
  "EXTR_SKIP", "EXTR_PREFIX_SAME", "EXTR_PREFIX_ALL", "EXTR_PREFIX_INVALID", "EXTR_PREFIX_IF_EXISTS", "EXTR_IF_EXISTS", 
  "EXTR_REFS"
].map(n => ({label: n, type: "constant"}))).concat([
  "abstract", "public", "private", "protected", "static", "extends", "implements"
].map(n => ({label: n, type: "scope"}))).concat([
  "NULL", "bool", "array", "string", "int", "float", "mixed", "void", "never", "const", "var", "class", "function",
  "trait", "interface"
].map(n => ({label: n, type: "type"}))).concat([
  "Directory", "stdClass", "Exception", "ErrorException", "php_user_filter", "Closure", "Generator", "ArithmeticError", 
  "AssertionError", "DivisionByZeroError", "Error", "Throwable", "ParseError", "TypeError", "self", "static", "parent",
  "ZipArchive"
].map(n => ({label: n, type: "class"}))).concat([
  // Error Handling and Logging
  "debug_backtrace", "debug_print_backtrace", "error_clear_last", "error_get_last", "error_log", "error_reporting", 
  "restore_error_handler", "restore_exception_handler", "set_error_handler", "set_exception_handler", "trigger_error", 
  "user_error", 
  // GNU Readline
  "readline_add_history", "readline_callback_handler_install", "readline_callback_handler_remove", "readline_callback_read_char", 
  "readline_clear_history", "readline_completion_function", "readline_info", "readline_list_history", "readline_on_new_line",
  "readline_read_history", "readline_redisplay", "readline_write_history", "readline", 
  // Bzip2
  "bzclose", "bzcompress", "bzdecompress", "bzerrno", "bzerror", "bzerrstr", "bzflush", "bzopen", "bzread", "bzwrite", 
  // Zip
  //TODO autocomplete function for certain class
  // "addEmptyDir", "addFile", "addFromString", "addGlob", "addPattern", "clearError", "close", "count", "deleteIndex", "deleteName", 
  // "extractTo", "getArchiveComment", "getArchiveFlag", "getCommentIndex", "getCommentName", "getExternalAttributesIndex", 
  // "getExternalAttributesName", "getNameIndex", "getStatusString", "getStream", "getStreamIndex", "getFromIndex", "getFromName", 
  // "getStreamName", "isCompressionMethodSupported", "isEncryptionMethodSupported", "locateName", "open", "registerCancelCallback", 
  // "registerProgressCallback", "renameIndex", "renameName", "replaceFile", "setArchiveComment", "setArchiveFlag", "setCommentIndex", 
  // "setCommentName", "setCompressionIndex", "setCompressionName", "setEncryptionIndex", "setEncryptionName", "setExternalAttributesIndex", 
  // "setExternalAttributesName", "setMtimeIndex", "setMtimeName", "setPassword", "statIndex", "statName", "unchangeAll", "unchangeArchive", 
  // "unchangeIndex", "unchangeName", 
  "zip_close", "zip_entry_close", "zip_entry_compressedsize", "zip_entry_compressionmethod", 
  "zip_entry_filesize", "zip_entry_name", "zip_entry_open", "zip_entry_read", "zip_open", "zip_read", 
  // Zlib Compression
  "deflate_add", "deflate_init", "gzclose", "gzcompress", "gzdecode", "gzdeflate", "gzencode", "gzeof", "gzfile", "gzgetc", 
  "gzgets", "gzgetss", "gzinflate", "gzopen", "gzpassthru", "gzputs", "gzread", "gzrewind", "gzseek", "gztell", "gzuncompress", 
  "gzwrite", "inflate_add", "inflate_get_read_len", "inflate_get_status", "inflate_init", "readgzfile", "zlib_decode", "zlib_encode", 
  "zlib_get_coding_type", 
  // Calendar
  "cal_days_in_month", "cal_from_jd", "cal_info", "cal_to_jd", "easter_date", "easter_days", "frenchtojd", "gregoriantojd", "jddayofweek", 
  "jdmonthname", "jdtofrench", "jdtogregorian", "jdtojewish", "jdtojulian", "jdtounix", "jewishtojd", "juliantojd", "unixtojd",
  // Date and Time
  "checkdate", "date_add", "date_create_from_format", "date_create_immutable_from_format", "date_create_immutable", "date_create", 
  "date_date_set", "date_default_timezone_get", "date_default_timezone_set", "date_diff", "date_format", "date_get_last_errors", 
  "date_interval_create_from_date_string", "date_interval_format", "date_isodate_set", "date_modify", "date_offset_get", "date_parse_from_format", 
  "date_parse", "date_sub", "date_sun_info", "date_sunrise", "date_sunset", "date_time_set", "date_timestamp_get", "date_timestamp_set", 
  "date_timezone_get", "date_timezone_set", "date", "getdate", "gettimeofday", "gmdate", "gmmktime", "gmstrftime", "idate", "localtime", 
  "microtime", "mktime", "strftime", "strptime", "strtotime", "time", "timezone_abbreviations_list", "timezone_identifiers_list", 
  "timezone_location_get", "timezone_name_from_abbr", "timezone_name_get", "timezone_offset_get", "timezone_open", "timezone_transitions_get", 
  "timezone_version_get", 
  // Directories
  "chdir", "chroot", "closedir", "dir", "getcwd", "opendir", "readdir", "rewinddir", "scandir", 
  // File Information
  "finfo_buffer", "finfo_close", "finfo_file", "finfo_open", "finfo_set_flags", "mime_content_type", 
  // Filesystem
  "basename", "chgrp", "chmod", "chown", "clearstatcache", "copy", "delete", "dirname", "disk_free_space", "disk_total_space", "diskfreespace", 
  "fclose", "fdatasync", "feof", "fflush", "fgetc", "fgetcsv", "fgets", "fgetss", "file_exists", "file_get_contents", "file_put_contents", 
  "file", "fileatime", "filectime", "filegroup", "fileinode", "filemtime", "fileowner", "fileperms", "filesize", "filetype", "flock", 
  "fnmatch", "fopen", "fpassthru", "fputcsv", "fputs", "fread", "fscanf", "fseek", "fstat", "fsync", "ftell", "ftruncate", "fwrite", "glob", 
  "is_dir", "is_executable", "is_file", "is_link", "is_readable", "is_uploaded_file", "is_writable", "is_writeable", "lchgrp", "lchown", 
  "link", "linkinfo", "lstat", "mkdir", "move_uploaded_file", "parse_ini_file", "parse_ini_string", "pathinfo", "pclose", "popen", "readfile", 
  "readlink", "realpath_cache_get", "realpath_cache_size", "realpath", "rename", "rewind", "rmdir", "set_file_buffer", "stat", "symlink", 
  "tempnam", "tmpfile", "touch", "umask", "unlink", 
  // Image Processing and GD
  "gd_info", "getimagesize", "getimagesizefromstring", "image_type_to_extension", "image_type_to_mime_type", "image2wbmp", "imageaffine", 
  "imageaffinematrixconcat", "imageaffinematrixget", "imagealphablending", "imageantialias", "imagearc", "imageavif", "imagebmp", 
  "imagechar", "imagecharup", "imagecolorallocate", "imagecolorallocatealpha", "imagecolorat", "imagecolorclosest", "imagecolorclosestalpha", 
  "imagecolorclosesthwb", "imagecolordeallocate", "imagecolorexact", "imagecolorexactalpha", "imagecolormatch", "imagecolorresolve", 
  "imagecolorresolvealpha", "imagecolorset", "imagecolorsforindex", "imagecolorstotal", "imagecolortransparent", "imageconvolution", 
  "imagecopy", "imagecopymerge", "imagecopymergegray", "imagecopyresampled", "imagecopyresized", "imagecreate", "imagecreatefromavif",
  "imagecreatefrombmp", "imagecreatefromgd2", "imagecreatefromgd2part", "imagecreatefromgd", "imagecreatefromgif", "imagecreatefromjpeg", 
  "imagecreatefrompng", "imagecreatefromstring", "imagecreatefromtga", "imagecreatefromwbmp", "imagecreatefromwebp", "imagecreatefromxbm", 
  "imagecreatefromxpm", "imagecreatetruecolor", "imagecrop", "imagecropauto", "imagedashedline", "imagedestroy", "imageellipse", "imagefill", 
  "imagefilledarc", "imagefilledellipse", "imagefilledpolygon", "imagefilledrectangle", "imagefilltoborder", "imagefilter", "imageflip", 
  "imagefontheight", "imagefontwidth", "imageftbbox", "imagefttext", "imagegammacorrect", "imagegd2", "imagegd", "imagegetclip", 
  "imagegetinterpolation", "imagegif", "imagegrabscreen", "imagegrabwindow", "imageinterlace", "imageistruecolor", "imagejpeg", "imagelayereffect", 
  "imageline", "imageloadfont", "imageopenpolygon", "imagepalettecopy", "imagepalettetotruecolor", "imagepng", "imagepolygon", "imagerectangle", 
  "imageresolution", "imagerotate", "imagesavealpha", "imagescale", "imagesetbrush", "imagesetclip", "imagesetinterpolation", "imagesetpixel", 
  "imagesetstyle", "imagesetthickness", "imagesettile", "imagestring", "imagestringup", "imagesx", "imagesy", "imagetruecolortopalette", 
  "imagettfbbox", "imagettftext", "imagetypes", "imagewbmp", "imagewebp", "imagexbm", "iptcembed", "iptcparse", "jpeg2wbmp", "png2wbmp", 
  // Exchangeable image information
  "exif_imagetype", "exif_read_data", "exif_tagname", "exif_thumbnail", "read_exif_data",
  // BCMath Arbitrary Precision Mathematics
  "bcadd", "bccomp", "bcdiv", "bcmod", "bcmul", "bcpow", "bcpowmod", "bcscale", "bcsqrt", "bcsub", 
  // GNU Multiple Precision
  "gmp_abs", "gmp_add", "gmp_and", "gmp_binomial", "gmp_clrbit", "gmp_cmp", "gmp_com", "gmp_div_q", "gmp_div_qr", "gmp_div_r", "gmp_div",
  "gmp_divexact", "gmp_export", "gmp_fact", "gmp_gcd", "gmp_gcdext", "gmp_hamdist", "gmp_import", "gmp_init", "gmp_intval", "gmp_invert", 
  "gmp_jacobi", "gmp_kronecker", "gmp_lcm", "gmp_legendre", "gmp_mod", "gmp_mul", "gmp_neg", "gmp_nextprime", "gmp_or", "gmp_perfect_power", 
  "gmp_perfect_square", "gmp_popcount", "gmp_pow", "gmp_powm", "gmp_prob_prime", "gmp_random_bits", "gmp_random_range", "gmp_random_seed", 
  "gmp_random", "gmp_root", "gmp_rootrem", "gmp_scan0", "gmp_scan1", "gmp_setbit", "gmp_sign", "gmp_sqrt", "gmp_sqrtrem", "gmp_strval", 
  "gmp_sub", "gmp_testbit", "gmp_xor", 
  // Process Control
  "pcntl_alarm", "pcntl_async_signals", "pcntl_errno", "pcntl_exec", "pcntl_fork", "pcntl_get_last_error", "pcntl_getpriority", "pcntl_rfork", 
  "pcntl_setpriority", "pcntl_signal_dispatch", "pcntl_signal_get_handler", "pcntl_signal", "pcntl_sigprocmask", "pcntl_sigtimedwait", 
  "pcntl_sigwaitinfo", "pcntl_strerror", "pcntl_unshare", "pcntl_wait", "pcntl_waitpid", "pcntl_wexitstatus", "pcntl_wifexited", "pcntl_wifsignaled", 
  "pcntl_wifstopped", "pcntl_wstopsig", "pcntl_wtermsig", 
  // JavaScript Object Notation
  "json_decode", "json_encode", "json_last_error_msg", "json_last_error", 
  // Randomness
  "getrandmax", "lcg_value", "mt_getrandmax", "mt_rand", "mt_srand", "rand", "random_bytes", "random_int", "srand", 
  // URLs
  "base64_decode", "base64_encode", "get_headers", "get_meta_tags", "http_build_query", "parse_url", "rawurldecode", "rawurlencode", "urldecode", 
  "urlencode", 
  // Client URL Library
  "curl_close", "curl_copy_handle", "curl_errno", "curl_error", "curl_escape", "curl_exec", "curl_getinfo", "curl_init", "curl_multi_add_handle", 
  "curl_multi_close", "curl_multi_errno", "curl_multi_exec", "curl_multi_getcontent", "curl_multi_info_read", "curl_multi_init", "curl_multi_remove_handle", 
  "curl_multi_select", "curl_multi_setopt", "curl_multi_strerror", "curl_pause", "curl_reset", "curl_setopt_array", "curl_setopt", "curl_share_close", 
  "curl_share_errno", "curl_share_init", "curl_share_setopt", "curl_share_strerror", "curl_strerror", "curl_unescape", "curl_upkeep", "curl_version", 
  // Sockets
  "socket_accept", "socket_addrinfo_bind", "socket_addrinfo_connect", "socket_addrinfo_explain", "socket_addrinfo_lookup", "socket_bind", 
  "socket_clear_error", "socket_close", "socket_cmsg_space", "socket_connect", "socket_create_listen", "socket_create_pair", "socket_create", 
  "socket_export_stream", "socket_get_option", "socket_getopt", "socket_getpeername", "socket_getsockname", "socket_import_stream", "socket_last_error", 
  "socket_listen", "socket_read", "socket_recv", "socket_recvfrom", "socket_recvmsg", "socket_select", "socket_send", "socket_sendmsg", "socket_sendto",
  "socket_set_block", "socket_set_nonblock", "socket_set_option", "socket_setopt", "socket_shutdown", "socket_strerror", "socket_write", 
  "socket_wsaprotocol_info_export", "socket_wsaprotocol_info_import", "socket_wsaprotocol_info_release", 
  // Session Handling
  "session_abort", "session_cache_expire", "session_cache_limiter", "session_commit", "session_create_id", "session_decode", "session_destroy", 
  "session_encode", "session_gc", "session_get_cookie_params", "session_id", "session_module_name", "session_name", "session_regenerate_id", 
  "session_register_shutdown", "session_reset", "session_save_path", "session_set_cookie_params", "session_start", "session_set_save_handler", 
  "session_status", "session_unset", "session_write_close", 
  // Strings
  "addcslashes", "addslashes", "bin2hex", "chop", "chr", "chunk_split", "convert_cyr_string", "convert_uudecode", "convert_uuencode", "count_chars", 
  "crc32", "crypt", "echo", "explode", "fprintf", "get_html_translation_table", "hebrev", "hebrevc", "hex2bin", "html_entity_decode", "htmlentities", 
  "htmlspecialchars_decode", "htmlspecialchars", "implode", "join", "lcfirst", "levenshtein", "localeconv", "ltrim", "md5_file", "md5", "metaphone", 
  "money_format", "nl_langinfo", "nl2br", "number_format", "ord", "parse_str", "print", "printf", "quoted_printable_decode", "quoted_printable_encode", 
  "quotemeta", "rtrim", "setlocale", "sha1_file", "sha1", "similar_text", "soundex", "sprintf", "sscanf", "str_contains", "str_ends_with", "str_getcsv", 
  "str_ireplace", "str_pad", "str_repeat", "str_replace", "str_rot13", "str_shuffle", "str_split", "str_starts_with", "str_word_count", "strcasecmp", 
  "strchr", "strcmp", "strcoll", "strcspn", "strip_tags", "stripcslashes", "stripos", "stripslashes", "stristr", "strlen", "strnatcasecmp", "strnatcmp", 
  "strncasecmp", "strncmp", "strpbrk", "strpos", "strrchr", "strrev", "strripos", "strrpos", "strspn", "strstr", "strtok", "strtolower", "strtoupper", 
  "strtr", "substr_compare", "substr_count", "substr_replace", "substr", "trim", "ucfirst", "ucwords", "utf8_decode", "utf8_encode", "vfprintf", 
  "vsprintf", "wordwrap", 
  // Arrays
  "array_change_key_case", "array_chunk", "array_column", "array_combine", "array_count_values", "array_diff_assoc", "array_diff_key", "array_diff_uassoc", 
  "array_diff_ukey", "array_diff", "array_fill_keys", "array_fill", "array_filter", "array_flip", "array_intersect_assoc", "array_intersect_key", 
  "array_intersect_uassoc", "array_intersect_ukey", "array_intersect", "array_is_list", "array_key_exists", "array_key_first", "array_key_last", 
  "array_keys", "array_map", "array_merge_recursive", "array_merge", "array_multisort", "array_pad", "array_pop", "array_product", "array_push", 
  "array_rand", "array_reduce", "array_replace_recursive", "array_replace", "array_reverse", "array_search", "array_shift", "array_slice", "array_splice", 
  "array_sum", "array_udiff_assoc", "array_udiff_uassoc", "array_udiff", "array_uintersect_assoc", "array_uintersect_uassoc", "array_uintersect", 
  "array_unique", "array_unshift", "array_values", "array_walk_recursive", "array_walk_recursive", "array", "arsort", "asort", "compact", "count", 
  "current", "each", "end", "extract", "in_array", "key_exists", "key", "krsort", "ksort", "list", "natcasesort", "natsort", "next", "pos", "prev", 
  "range", "reset", "rsort", "shuffle", "sizeof", "sort", "uasort", "uksort", "usort",
  // Class/Object Information
  "__autoload", "class_alias", "class_exists", "enum_exists", "get_called_class", "get_class_methods", "get_class_vars", "get_class", "get_declared_classes", 
  "get_declared_interfaces", "get_declared_traits", "get_mangled_object_vars", "get_object_vars", "get_parent_class", "interface_exists", "is_a", 
  "is_subclass_of", "method_exists", "property_exists", "trait_exists", 
  // Data Filtering
  "filter_has_var", "filter_id", "filter_input_array", "filter_input", "filter_list", "filter_var_array", "filter_var", 
  // Function Handling
  "call_user_func_array", "call_user_func", "create_function", "forward_static_call_array", "forward_static_call", "func_get_arg", "func_get_args", 
  "func_num_args", "function_exists", "get_defined_functions", "register_shutdown_function", "register_tick_function", "unregister_tick_function", 
  // Variable handling
  "boolval", "debug_zval_dump", "doubleval", "empty", "floatval", "get_debug_type", "get_defined_vars", "get_resource_id", "get_resource_type", 
  "gettype", "intval", "is_array", "is_bool", "is_callable", "is_countable", "is_double", "is_float", "is_int", "is_integer", "is_iterable", "is_long", 
  "is_null", "is_numeric", "is_object", "is_real", "is_resource", "is_scalar", "is_string", "isset", "print_r", "serialize", "settype", "strval", 
  "unserialize", "unset", "var_dump", "var_export", 
  // XML Parser
  "xml_error_string", "xml_get_current_byte_index", "xml_get_current_column_number", "xml_get_current_line_number", "xml_get_error_code", "xml_parse_into_struct", 
  "xml_parse", "xml_parser_create_ns", "xml_parser_create", "xml_parser_free", "xml_parser_get_option", "xml_parser_set_option", "xml_set_character_data_handler", 
  "xml_set_default_handler", "xml_set_element_handler", "xml_set_end_namespace_decl_handler", "xml_set_external_entity_ref_handler", "xml_set_notation_decl_handler",
  "xml_set_object", "xml_set_processing_instruction_handler", "xml_set_start_namespace_decl_handler", "xml_set_unparsed_entity_decl_handler"
].map(n => ({label: n, type: "function"})))

export const snippets: readonly Completion[] = [
  snip("function ${name}(${params}):\n\t${}", {
    label: "def",
    detail: "function",
    type: "keyword"
  }),
  snip("for ($${index} = 0; $${index} < ${bound}; $${index}++) {\n\t${}\n}", {
    label: "for",
    detail: "loop",
    type: "keyword"
  }),
  snip("foreach (${collection} as ${name}) {\n\t${}\n}", {
    label: "foreach",
    detail: "loop",
    type: "keyword"
  }),
  snip("do {\n\t${}\n} while (${})", {
    label: "do",
    detail: "loop",
    type: "keyword"
  }),
  snip("while (${}) {\n\t${}\n}", {
    label: "while",
    detail: "loop",
    type: "keyword"
  }),
  snip("try {\n\t${}\n} catch (${error}) {\n\t${}\n}", {
    label: "try",
    detail: "/ catch block",
    type: "keyword"
  }),
  snip("if (${}) {\n\t${}\n}", {
    label: "if",
    detail: "block",
    type: "keyword"
  }),
  snip("if (${}) {\n\t${}\n} else {\n\t${}\n}", {
    label: "if",
    detail: "/ else block",
    type: "keyword"
  }),
  snip("class ${name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}", {
    label: "class",
    detail: "definition",
    type: "keyword"
  }),
  snip("require ${module}", {
    label: "require",
    detail: "statement",
    type: "keyword"
  }),
  snip("require_once ${module}", {
    label: "require_once",
    detail: "statement",
    type: "keyword"
  }),
  snip("include ${module}", {
    label: "include",
    detail: "statement",
    type: "keyword"
  }),
  snip("include_once ${module}", {
    label: "include_once",
    detail: "statement",
    type: "keyword"
  })
]

/// Autocompletion for built-in Python globals and keywords.
export const globalCompletion = ifNotIn(dontComplete, completeFromList(globals.concat(snippets)))
