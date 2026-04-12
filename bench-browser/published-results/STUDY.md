# Browser Benchmark Results

## Summary

| Condition | Tasks | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success% |
|-----------|-------|-----------------|--------|-------------------|----------|------------|-------------|-----------|----------|
| actionbook | 70 | 95061 | 89% | 695 | $0.0656 | $4.60 | 24.1s | 5.3 | 99% |
| agent-browser | 70 | 93074 | 83% | 558 | $0.0879 | $6.15 | 24.6s | 4.8 | 99% |
| chrome-devtools-axi | 70 | 79141 | 82% | 573 | $0.0744 | $5.21 | 21.5s | 4.5 | 100% |
| chrome-devtools-mcp-code | 70 | 129606 | 85% | 1480 | $0.1196 | $8.38 | 36.2s | 6.4 | 100% |
| chrome-devtools-mcp-compressed-cli | 70 | 130779 | 91% | 888 | $0.0911 | $6.38 | 29.7s | 7.6 | 100% |
| chrome-devtools-mcp-search | 70 | 133712 | 90% | 1014 | $0.0955 | $6.69 | 29.4s | 7.5 | 99% |
| chrome-devtools-mcp | 70 | 184711 | 94% | 825 | $0.1005 | $7.03 | 26.0s | 6.2 | 99% |
| dev-browser | 70 | 82532 | 85% | 1292 | $0.0779 | $5.46 | 28.6s | 4.9 | 99% |

## Methodology

- **Agent model**: claude-sonnet-4-6
- **Judge model**: claude-sonnet-4-6
- **Repeats per task**: 5
- **Execution**: Sequential with randomized condition/task order
- **Browser isolation**: Fresh browser per run (daemon restarted between runs)

### Known Limitations

- MCP conditions spawn Chrome per run (inherent to MCP architecture), adding ~2-5s cold-start overhead
- MCP tool schemas consume ~28.5% of input tokens — cost comparisons reflect total API cost including schema overhead
- `--disallowedTools` removes tools from use but not from the tool list visible to agents

### Failure Analysis

| Failure Type | Count |
|-------------|-------|
| task_failure | 5 |


## Per-Task Breakdown

### wikipedia_link_follow

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 114911 | 92% | 855 | $0.0773 | $0.3863 | 25.9s | 6.4 | 5/5 |
| agent-browser | 71558 | 80% | 316 | $0.0632 | $0.3158 | 75.7s | 3.6 | 4/5 |
| chrome-devtools-axi | 96502 | 86% | 506 | $0.0838 | $0.4192 | 18.7s | 5.2 | 5/5 |
| chrome-devtools-mcp-code | 255557 | 93% | 2849 | $0.1725 | $0.8625 | 51.5s | 12.8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 125474 | 91% | 547 | $0.0852 | $0.4260 | 27.9s | 7.2 | 5/5 |
| chrome-devtools-mcp-search | 183741 | 93% | 1373 | $0.1171 | $0.5854 | 35.9s | 10.0 | 5/5 |
| chrome-devtools-mcp | 235669 | 96% | 819 | $0.1144 | $0.5719 | 29.3s | 7.6 | 5/5 |
| dev-browser | 98829 | 88% | 1372 | $0.0892 | $0.4462 | 32.2s | 5.6 | 5/5 |

### multi_site_research

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 270128 | 96% | 1860 | $0.1423 | $0.7116 | 51.9s | 14.4 | 5/5 |
| agent-browser | 82235 | 85% | 875 | $0.1394 | $0.6972 | 29.2s | 6.6 | 5/5 |
| chrome-devtools-axi | 57051 | 78% | 506 | $0.0904 | $0.4522 | 26.3s | 4.8 | 5/5 |
| chrome-devtools-mcp-code | 109533 | 82% | 1599 | $0.1995 | $0.9975 | 75.7s | 5.6 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 252341 | 94% | 2076 | $0.1541 | $0.7706 | 55.4s | 17.2 | 5/5 |
| chrome-devtools-mcp-search | 275202 | 95% | 2370 | $0.1675 | $0.8377 | 59.9s | 16.6 | 5/5 |
| chrome-devtools-mcp | 426808 | 97% | 2304 | $0.2103 | $1.0516 | 59.4s | 17.4 | 5/5 |
| dev-browser | 70167 | 84% | 1876 | $0.0842 | $0.4211 | 29.7s | 6.4 | 5/5 |

### wikipedia_search_click

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 173503 | 95% | 1251 | $0.1019 | $0.5095 | 37.9s | 9.6 | 5/5 |
| agent-browser | 139018 | 88% | 507 | $0.1087 | $0.5437 | 24.1s | 6.2 | 5/5 |
| chrome-devtools-axi | 91577 | 83% | 478 | $0.0872 | $0.4362 | 19.2s | 5.0 | 5/5 |
| chrome-devtools-mcp-code | 263777 | 91% | 2655 | $0.1905 | $0.9525 | 60.6s | 11.8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 180686 | 93% | 817 | $0.1068 | $0.5339 | 35.4s | 10.0 | 5/5 |
| chrome-devtools-mcp-search | 181431 | 93% | 961 | $0.1119 | $0.5595 | 36.7s | 9.8 | 5/5 |
| chrome-devtools-mcp | 257230 | 96% | 736 | $0.1227 | $0.6134 | 29.3s | 8.2 | 5/5 |
| dev-browser | 97228 | 85% | 1232 | $0.0863 | $0.4315 | 39.9s | 5.4 | 5/5 |

### read_static_page

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 33821 | 82% | 176 | $0.0335 | $0.1676 | 12.3s | 2.0 | 5/5 |
| agent-browser | 58436 | 81% | 247 | $0.0598 | $0.2991 | 11.4s | 3.2 | 5/5 |
| chrome-devtools-axi | 77299 | 88% | 417 | $0.0608 | $0.3041 | 14.5s | 4.6 | 5/5 |
| chrome-devtools-mcp-code | 32117 | 76% | 245 | $0.0401 | $0.2007 | 7.9s | 2.0 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 72082 | 88% | 322 | $0.0550 | $0.2752 | 17.5s | 4.4 | 5/5 |
| chrome-devtools-mcp-search | 75736 | 86% | 347 | $0.0631 | $0.3157 | 14.8s | 4.4 | 5/5 |
| chrome-devtools-mcp | 90664 | 92% | 156 | $0.0552 | $0.2761 | 10.4s | 3.0 | 5/5 |
| dev-browser | 48270 | 84% | 341 | $0.0460 | $0.2301 | 11.1s | 3.0 | 5/5 |

### wikipedia_infobox_hop

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 141272 | 94% | 1041 | $0.0865 | $0.4326 | 32.6s | 7.8 | 5/5 |
| agent-browser | 208551 | 87% | 798 | $0.1637 | $0.8185 | 34.8s | 8.0 | 5/5 |
| chrome-devtools-axi | 91981 | 86% | 642 | $0.0819 | $0.4093 | 19.0s | 5.0 | 5/5 |
| chrome-devtools-mcp-code | 220663 | 90% | 1411 | $0.1581 | $0.7906 | 37.9s | 10.2 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 193884 | 92% | 1176 | $0.1263 | $0.6313 | 37.2s | 10.0 | 5/5 |
| chrome-devtools-mcp-search | 229856 | 92% | 1780 | $0.1564 | $0.7822 | 46.7s | 11.8 | 5/5 |
| chrome-devtools-mcp | 243281 | 96% | 1101 | $0.1225 | $0.6125 | 31.9s | 7.8 | 5/5 |
| dev-browser | 107423 | 87% | 1528 | $0.0897 | $0.4485 | 34.7s | 6.0 | 5/5 |

### github_navigate_to_file

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 79972 | 91% | 618 | $0.0573 | $0.2865 | 22.8s | 4.6 | 5/5 |
| agent-browser | 112770 | 89% | 593 | $0.0863 | $0.4316 | 23.1s | 5.8 | 5/5 |
| chrome-devtools-axi | 86482 | 88% | 494 | $0.0705 | $0.3526 | 16.0s | 5.0 | 5/5 |
| chrome-devtools-mcp-code | 71883 | 83% | 976 | $0.0730 | $0.3651 | 28.6s | 4.0 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 106146 | 90% | 569 | $0.0762 | $0.3808 | 26.4s | 6.2 | 5/5 |
| chrome-devtools-mcp-search | 89728 | 89% | 662 | $0.0703 | $0.3513 | 20.8s | 5.2 | 5/5 |
| chrome-devtools-mcp | 109610 | 93% | 408 | $0.0662 | $0.3311 | 18.3s | 3.6 | 5/5 |
| dev-browser | 59887 | 85% | 822 | $0.0605 | $0.3023 | 33.3s | 3.6 | 5/5 |

### wikipedia_fact_lookup

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 51525 | 87% | 297 | $0.0429 | $0.2144 | 15.2s | 3.0 | 5/5 |
| agent-browser | 72286 | 82% | 324 | $0.0687 | $0.3437 | 12.9s | 3.8 | 5/5 |
| chrome-devtools-axi | 33933 | 73% | 172 | $0.0438 | $0.2191 | 7.9s | 2.0 | 5/5 |
| chrome-devtools-mcp-code | 58428 | 80% | 511 | $0.0613 | $0.3065 | 16.0s | 3.2 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 83507 | 89% | 455 | $0.0624 | $0.3119 | 18.8s | 5.0 | 5/5 |
| chrome-devtools-mcp-search | 85937 | 89% | 502 | $0.0664 | $0.3320 | 17.3s | 5.0 | 5/5 |
| chrome-devtools-mcp | 90815 | 92% | 299 | $0.0576 | $0.2879 | 15.1s | 3.0 | 5/5 |
| dev-browser | 109363 | 90% | 1336 | $0.0862 | $0.4308 | 25.3s | 6.4 | 5/5 |

### wikipedia_table_read

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 52708 | 85% | 404 | $0.0486 | $0.2432 | 17.2s | 3.0 | 5/5 |
| agent-browser | 95886 | 88% | 673 | $0.0797 | $0.3987 | 20.3s | 5.0 | 5/5 |
| chrome-devtools-axi | 34478 | 72% | 273 | $0.0473 | $0.2366 | 10.4s | 2.0 | 5/5 |
| chrome-devtools-mcp-code | 121966 | 86% | 1544 | $0.1074 | $0.5370 | 31.3s | 6.0 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 83951 | 89% | 825 | $0.0694 | $0.3470 | 22.6s | 5.0 | 5/5 |
| chrome-devtools-mcp-search | 116290 | 91% | 1175 | $0.0889 | $0.4444 | 26.8s | 6.6 | 5/5 |
| chrome-devtools-mcp | 147073 | 94% | 804 | $0.0850 | $0.4249 | 22.8s | 4.8 | 5/5 |
| dev-browser | 134419 | 92% | 1708 | $0.1004 | $0.5021 | 32.5s | 7.8 | 5/5 |

### wikipedia_deep_extraction

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 52173 | 86% | 507 | $0.0482 | $0.2408 | 17.4s | 3.0 | 4/5 |
| agent-browser | 110138 | 88% | 1367 | $0.0968 | $0.4839 | 31.8s | 5.8 | 5/5 |
| chrome-devtools-axi | 34093 | 73% | 337 | $0.0468 | $0.2341 | 9.2s | 2.0 | 5/5 |
| chrome-devtools-mcp-code | 167583 | 88% | 2318 | $0.1473 | $0.7364 | 40.8s | 7.6 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 124909 | 92% | 1551 | $0.0969 | $0.4847 | 34.1s | 7.2 | 5/5 |
| chrome-devtools-mcp-search | 135962 | 91% | 1671 | $0.1060 | $0.5299 | 34.7s | 7.6 | 5/5 |
| chrome-devtools-mcp | 117196 | 92% | 960 | $0.0795 | $0.3977 | 21.8s | 3.8 | 5/5 |
| dev-browser | 73537 | 84% | 1387 | $0.0804 | $0.4019 | 27.4s | 4.2 | 5/5 |

### github_repo_stars

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 90130 | 92% | 595 | $0.0595 | $0.2976 | 21.8s | 5.2 | 5/5 |
| agent-browser | 80519 | 84% | 387 | $0.0697 | $0.3485 | 13.3s | 4.4 | 5/5 |
| chrome-devtools-axi | 86010 | 87% | 479 | $0.0705 | $0.3527 | 17.7s | 5.0 | 5/5 |
| chrome-devtools-mcp-code | 109788 | 85% | 1080 | $0.1049 | $0.5246 | 28.6s | 5.8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 120096 | 89% | 724 | $0.0900 | $0.4502 | 27.7s | 6.8 | 5/5 |
| chrome-devtools-mcp-search | 69483 | 85% | 328 | $0.0614 | $0.3072 | 19.1s | 4.0 | 5/5 |
| chrome-devtools-mcp | 166780 | 91% | 752 | $0.1092 | $0.5462 | 26.9s | 5.4 | 5/5 |
| dev-browser | 70268 | 85% | 1020 | $0.0661 | $0.3303 | 26.4s | 4.2 | 5/5 |

### navigate_404

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 58942 | 87% | 436 | $0.0494 | $0.2470 | 20.9s | 3.4 | 5/5 |
| agent-browser | 77400 | 84% | 450 | $0.0727 | $0.3635 | 15.9s | 4.2 | 5/5 |
| chrome-devtools-axi | 85673 | 88% | 596 | $0.0694 | $0.3468 | 17.4s | 5.0 | 5/5 |
| chrome-devtools-mcp-code | 63178 | 84% | 769 | $0.0636 | $0.3182 | 18.0s | 3.8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 144313 | 92% | 1029 | $0.0979 | $0.4897 | 33.8s | 8.2 | 5/5 |
| chrome-devtools-mcp-search | 108812 | 88% | 644 | $0.0864 | $0.4321 | 24.7s | 6.0 | 5/5 |
| chrome-devtools-mcp | 152985 | 94% | 450 | $0.0833 | $0.4165 | 19.0s | 5.0 | 5/5 |
| dev-browser | 58314 | 80% | 876 | $0.0626 | $0.3128 | 21.0s | 3.4 | 5/5 |

### tabular_data_analysis

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 69291 | 85% | 640 | $0.0633 | $0.3166 | 21.3s | 3.8 | 5/5 |
| agent-browser | 55691 | 79% | 491 | $0.0641 | $0.3206 | 17.0s | 3.0 | 5/5 |
| chrome-devtools-axi | 35228 | 71% | 312 | $0.0507 | $0.2535 | 10.7s | 2.0 | 5/5 |
| chrome-devtools-mcp-code | 104590 | 81% | 1071 | $0.1017 | $0.5087 | 24.5s | 4.8 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 76968 | 88% | 648 | $0.0639 | $0.3196 | 22.0s | 4.6 | 5/5 |
| chrome-devtools-mcp-search | 112237 | 90% | 904 | $0.0847 | $0.4236 | 25.5s | 6.4 | 5/5 |
| chrome-devtools-mcp | 97494 | 92% | 516 | $0.0648 | $0.3241 | 17.1s | 3.2 | 5/5 |
| dev-browser | 36863 | 75% | 566 | $0.0509 | $0.2543 | 13.0s | 2.2 | 5/5 |

### multi_page_comparison

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 90738 | 92% | 542 | $0.0615 | $0.3074 | 22.2s | 5.2 | 5/5 |
| agent-browser | 76231 | 84% | 327 | $0.0693 | $0.3463 | 16.5s | 4.0 | 5/5 |
| chrome-devtools-axi | 89219 | 86% | 397 | $0.0744 | $0.3719 | 22.1s | 5.0 | 5/5 |
| chrome-devtools-mcp-code | 71564 | 84% | 1069 | $0.0743 | $0.3713 | 24.2s | 4.0 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 166693 | 93% | 897 | $0.1046 | $0.5231 | 30.7s | 9.4 | 5/5 |
| chrome-devtools-mcp-search | 137752 | 92% | 933 | $0.0911 | $0.4555 | 27.2s | 7.8 | 5/5 |
| chrome-devtools-mcp | 215693 | 96% | 758 | $0.1063 | $0.5317 | 23.7s | 7.0 | 5/5 |
| dev-browser | 71037 | 86% | 1158 | $0.0699 | $0.3494 | 20.4s | 4.4 | 5/5 |

### github_issue_investigation

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| actionbook | 51735 | 87% | 503 | $0.0469 | $0.2345 | 18.4s | 3.0 | 5/5 |
| agent-browser | 62322 | 71% | 459 | $0.0886 | $0.4430 | 17.9s | 3.0 | 5/5 |
| chrome-devtools-axi | 208453 | 89% | 2416 | $0.1635 | $0.8174 | 92.3s | 10.0 | 5/5 |
| chrome-devtools-mcp-code | 163860 | 81% | 2620 | $0.1808 | $0.9038 | 61.7s | 8.4 | 5/5 |
| chrome-devtools-mcp-compressed-cli | 99862 | 87% | 797 | $0.0871 | $0.4353 | 26.6s | 5.6 | 5/5 |
| chrome-devtools-mcp-search | 69799 | 85% | 539 | $0.0659 | $0.3293 | 21.5s | 4.0 | 4/5 |
| chrome-devtools-mcp | 234649 | 95% | 1491 | $0.1292 | $0.6461 | 39.3s | 7.4 | 4/5 |
| dev-browser | 119844 | 89% | 2864 | $0.1189 | $0.5947 | 53.6s | 6.6 | 4/5 |

