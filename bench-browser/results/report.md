# Browser Benchmark Results

## Summary

| Condition | Tasks | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success% |
|-----------|-------|-----------------|--------|-------------------|----------|------------|-------------|-----------|----------|
| pinchtab | 80 | 234008 | 85% | 1216 | $0.1778 | $14.23 | 36.5s | 7 | 94% |
| chrome-devtools-mcp | 80 | 276134 | 90% | 905 | $0.1757 | $14.06 | 31.3s | 6 | 93% |
| chrome-devtools-mcp-search | 80 | 218621 | 73% | 1006 | $0.1678 | $13.42 | 34.8s | 7 | 71% |
| chrome-devtools-mcp-code | 80 | 277270 | 86% | 1875 | $0.2077 | $16.62 | 45.5s | 8 | 91% |
| agent-browser | 80 | 205393 | 85% | 921 | $0.1644 | $13.15 | 30.3s | 6 | 96% |
| chrome-devtools-mcp-compressed-cli | 80 | 204014 | 85% | 858 | $0.1671 | $13.37 | 31.2s | 6 | 94% |

## Per-Task Breakdown

### read_static_page

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| pinchtab | 84899 | 73% | 211 | $0.1054 | $0.5268 | 10.0s | 3 | 5/5 |
| chrome-devtools-mcp | 135665 | 86% | 184 | $0.1097 | $0.5486 | 17.4s | 3 | 5/5 |
| chrome-devtools-mcp-search | 122495 | 85% | 336 | $0.1050 | $0.5250 | 16.3s | 4 | 5/5 |
| chrome-devtools-mcp-code | 92004 | 80% | 368 | $0.0950 | $0.4751 | 15.0s | 3 | 5/5 |
| agent-browser | 86412 | 73% | 211 | $0.1064 | $0.5320 | 15.9s | 3 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 90757 | 81% | 241 | $0.0915 | $0.4576 | 13.2s | 3 | 5/5 |

### wikipedia_fact_lookup

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| pinchtab | 146644 | 84% | 572 | $0.1307 | $0.6533 | 23.0s | 5 | 5/5 |
| chrome-devtools-mcp | 136372 | 84% | 296 | $0.1199 | $0.5996 | 15.3s | 3 | 5/5 |
| agent-browser | 118882 | 79% | 398 | $0.1217 | $0.6083 | 15.7s | 4 | 5/5 |
| chrome-devtools-mcp-code | 212394 | 85% | 1072 | $0.1735 | $0.8674 | 30.2s | 6 | 5/5 |
| chrome-devtools-mcp-search | 154482 | 85% | 546 | $0.1339 | $0.6696 | 25.9s | 5 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 91024 | 76% | 266 | $0.1074 | $0.5371 | 17.4s | 3 | 5/5 |

### github_repo_stars

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| chrome-devtools-mcp | 238148 | 90% | 728 | $0.1622 | $0.8110 | 28.9s | 5 | 5/5 |
| pinchtab | 125107 | 80% | 434 | $0.1316 | $0.6581 | 16.6s | 4 | 5/5 |
| agent-browser | 139996 | 82% | 536 | $0.1375 | $0.6874 | 20.6s | 4 | 5/5 |
| chrome-devtools-mcp-search | 29973 | 29% | 2 | $0.0827 | $0.4137 | 20.7s | 0 | 0/5 |
| chrome-devtools-mcp-code | 358471 | 89% | 1925 | $0.2442 | $1.2210 | 53.7s | 10 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 201260 | 86% | 937 | $0.1659 | $0.8295 | 31.8s | 6 | 5/5 |

### httpbin_page_read

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 93338 | 75% | 402 | $0.1146 | $0.5730 | 17.0s | 3 | 5/5 |
| pinchtab | 73440 | 68% | 347 | $0.1061 | $0.5307 | 14.4s | 2 | 4/5 |
| chrome-devtools-mcp | 137039 | 83% | 349 | $0.1255 | $0.6276 | 17.4s | 3 | 5/5 |
| chrome-devtools-mcp-search | 141109 | 83% | 537 | $0.1327 | $0.6636 | 20.5s | 5 | 5/5 |
| chrome-devtools-mcp-code | 92703 | 75% | 553 | $0.1158 | $0.5789 | 14.7s | 3 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 91645 | 75% | 416 | $0.1121 | $0.5603 | 15.0s | 3 | 5/5 |

### wikipedia_table_read

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| pinchtab | 195936 | 87% | 1118 | $0.1618 | $0.8090 | 38.2s | 6 | 5/5 |
| agent-browser | 140826 | 82% | 864 | $0.1429 | $0.7144 | 21.1s | 4 | 5/5 |
| chrome-devtools-mcp | 220232 | 90% | 1058 | $0.1604 | $0.8018 | 28.8s | 5 | 5/5 |
| chrome-devtools-mcp-search | 410530 | 93% | 2666 | $0.2619 | $1.3093 | 66.6s | 12 | 5/5 |
| chrome-devtools-mcp-code | 363359 | 93% | 2919 | $0.2431 | $1.2157 | 57.8s | 11 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 229110 | 86% | 1219 | $0.1848 | $0.9239 | 32.1s | 7 | 5/5 |

### wikipedia_link_follow

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 247308 | 89% | 921 | $0.1779 | $0.8893 | 35.0s | 8 | 5/5 |
| chrome-devtools-mcp | 388972 | 94% | 1004 | $0.2121 | $1.0606 | 52.3s | 8 | 5/5 |
| pinchtab | 315720 | 92% | 1271 | $0.2014 | $1.0069 | 42.9s | 10 | 5/5 |
| chrome-devtools-mcp-search | 415558 | 92% | 1887 | $0.2731 | $1.3657 | 50.5s | 13 | 5/5 |
| chrome-devtools-mcp-code | 313188 | 90% | 1911 | $0.2231 | $1.1153 | 50.1s | 9 | 3/5 |
| chrome-devtools-mcp-compressed-cli | 220491 | 87% | 636 | $0.1709 | $0.8546 | 28.0s | 7 | 5/5 |

### github_navigate_to_file

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 400719 | 93% | 2522 | $0.2547 | $1.2733 | 82.2s | 12 | 2/5 |
| pinchtab | 299784 | 90% | 1979 | $0.2131 | $1.0653 | 61.1s | 9 | 1/5 |
| chrome-devtools-mcp | 344032 | 92% | 996 | $0.2024 | $1.0118 | 44.8s | 7 | 0/5 |
| chrome-devtools-mcp-search | 152851 | 54% | 820 | $0.1377 | $0.6884 | 31.1s | 4 | 1/5 |
| chrome-devtools-mcp-code | 485318 | 93% | 3151 | $0.2955 | $1.4773 | 112.5s | 14 | 0/5 |
| chrome-devtools-mcp-compressed-cli | 281639 | 90% | 1362 | $0.1973 | $0.9863 | 57.9s | 9 | 0/5 |

### wikipedia_infobox_hop

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 366643 | 92% | 1207 | $0.2235 | $1.1174 | 42.8s | 11 | 5/5 |
| chrome-devtools-mcp | 333988 | 93% | 1083 | $0.1979 | $0.9897 | 37.7s | 7 | 5/5 |
| chrome-devtools-mcp-search | 242930 | 65% | 981 | $0.2015 | $1.0077 | 40.8s | 7 | 3/5 |
| pinchtab | 482800 | 94% | 2179 | $0.2734 | $1.3670 | 70.6s | 14 | 5/5 |
| chrome-devtools-mcp-code | 318026 | 88% | 1829 | $0.2474 | $1.2370 | 45.3s | 9 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 285973 | 90% | 934 | $0.1993 | $0.9967 | 34.9s | 8 | 5/5 |

### multi_page_comparison

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| chrome-devtools-mcp | 330844 | 93% | 882 | $0.1912 | $0.9562 | 28.8s | 7 | 5/5 |
| agent-browser | 231102 | 89% | 871 | $0.1702 | $0.8508 | 27.1s | 7 | 5/5 |
| chrome-devtools-mcp-search | 384795 | 93% | 1729 | $0.2318 | $1.1591 | 46.2s | 12 | 5/5 |
| pinchtab | 200161 | 87% | 812 | $0.1568 | $0.7840 | 23.7s | 6 | 5/5 |
| chrome-devtools-mcp-code | 260197 | 84% | 2057 | $0.2095 | $1.0477 | 41.2s | 8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 260183 | 90% | 841 | $0.1783 | $0.8915 | 32.0s | 8 | 5/5 |

### wikipedia_search_click

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 218378 | 88% | 696 | $0.1688 | $0.8442 | 23.8s | 7 | 5/5 |
| chrome-devtools-mcp | 398812 | 94% | 798 | $0.2139 | $1.0696 | 33.4s | 9 | 5/5 |
| chrome-devtools-mcp-search | 219267 | 67% | 800 | $0.1619 | $0.8095 | 39.9s | 6 | 3/5 |
| pinchtab | 388248 | 93% | 1725 | $0.2314 | $1.1568 | 59.8s | 12 | 5/5 |
| chrome-devtools-mcp-code | 620262 | 93% | 3497 | $0.3756 | $1.8779 | 84.9s | 16 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 286271 | 91% | 944 | $0.1919 | $0.9597 | 33.3s | 9 | 5/5 |

### wikipedia_deep_extraction

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 264724 | 88% | 1472 | $0.2027 | $1.0134 | 41.5s | 8 | 5/5 |
| chrome-devtools-mcp | 290367 | 91% | 1821 | $0.1993 | $0.9963 | 37.3s | 6 | 4/5 |
| chrome-devtools-mcp-search | 187947 | 77% | 1211 | $0.1558 | $0.7789 | 30.1s | 6 | 4/5 |
| pinchtab | 210455 | 87% | 1517 | $0.1784 | $0.8918 | 40.2s | 7 | 5/5 |
| chrome-devtools-mcp-code | 333082 | 92% | 2990 | $0.2380 | $1.1901 | 54.9s | 10 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 205633 | 83% | 1432 | $0.2039 | $1.0194 | 37.0s | 6 | 5/5 |

### github_issue_investigation

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 162792 | 83% | 946 | $0.1565 | $0.7823 | 26.5s | 5 | 5/5 |
| chrome-devtools-mcp | 366829 | 92% | 2087 | $0.2272 | $1.1361 | 49.9s | 8 | 5/5 |
| chrome-devtools-mcp-search | 109763 | 42% | 613 | $0.1216 | $0.6079 | 26.3s | 3 | 1/5 |
| pinchtab | 325845 | 88% | 3005 | $0.2466 | $1.2332 | 61.5s | 9 | 5/5 |
| chrome-devtools-mcp-code | 213171 | 82% | 1383 | $0.1923 | $0.9617 | 34.4s | 6 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 174300 | 83% | 930 | $0.1666 | $0.8330 | 30.0s | 5 | 5/5 |

### multi_site_research

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 331579 | 92% | 1187 | $0.2113 | $1.0567 | 40.8s | 10 | 5/5 |
| chrome-devtools-mcp | 551300 | 96% | 1759 | $0.2766 | $1.3832 | 57.3s | 12 | 5/5 |
| chrome-devtools-mcp-search | 464116 | 93% | 2184 | $0.2810 | $1.4049 | 63.9s | 14 | 5/5 |
| pinchtab | 368200 | 92% | 1504 | $0.2377 | $1.1887 | 47.8s | 11 | 5/5 |
| chrome-devtools-mcp-code | 278936 | 89% | 2141 | $0.2135 | $1.0674 | 48.3s | 8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 360423 | 91% | 1317 | $0.2368 | $1.1841 | 42.0s | 11 | 5/5 |

### tabular_data_analysis

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 217205 | 86% | 1365 | $0.1863 | $0.9314 | 37.0s | 7 | 5/5 |
| chrome-devtools-mcp | 135399 | 84% | 443 | $0.1219 | $0.6095 | 15.2s | 3 | 5/5 |
| chrome-devtools-mcp-search | 246063 | 89% | 1002 | $0.1733 | $0.8665 | 32.2s | 8 | 5/5 |
| pinchtab | 264205 | 85% | 1683 | $0.2155 | $1.0775 | 38.7s | 8 | 5/5 |
| chrome-devtools-mcp-code | 233050 | 89% | 1902 | $0.1823 | $0.9113 | 35.6s | 7 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 169912 | 77% | 937 | $0.1922 | $0.9609 | 27.9s | 5 | 5/5 |

### navigate_404

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 111617 | 79% | 413 | $0.1201 | $0.6005 | 14.5s | 4 | 5/5 |
| chrome-devtools-mcp | 227972 | 90% | 501 | $0.1547 | $0.7734 | 19.1s | 5 | 5/5 |
| chrome-devtools-mcp-search | 29792 | 29% | 3 | $0.0821 | $0.4104 | 20.3s | 0 | 0/5 |
| pinchtab | 141586 | 82% | 537 | $0.1337 | $0.6687 | 19.8s | 5 | 5/5 |
| chrome-devtools-mcp-code | 92604 | 75% | 645 | $0.1175 | $0.5874 | 15.6s | 3 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 154945 | 85% | 603 | $0.1372 | $0.6858 | 42.8s | 5 | 5/5 |

### broken_element_interaction

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| agent-browser | 154764 | 85% | 718 | $0.1355 | $0.6773 | 22.9s | 5 | 5/5 |
| chrome-devtools-mcp | 182178 | 88% | 482 | $0.1368 | $0.6841 | 17.1s | 4 | 5/5 |
| chrome-devtools-mcp-search | 186272 | 87% | 784 | $0.1480 | $0.7399 | 25.7s | 6 | 5/5 |
| pinchtab | 121099 | 82% | 562 | $0.1216 | $0.6079 | 15.6s | 4 | 5/5 |
| chrome-devtools-mcp-code | 169561 | 83% | 1651 | $0.1569 | $0.7845 | 34.3s | 5 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 160651 | 86% | 716 | $0.1378 | $0.6890 | 24.6s | 5 | 5/5 |

