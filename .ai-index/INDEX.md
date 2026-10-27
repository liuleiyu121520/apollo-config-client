<!-- AI Index Generated File: do not edit manually. Regenerate with scripts/update_ai_index.js. -->

# AI Codebase Index

## 使用规则

- Agent 在开发、审查、测试、重构前，必须先读取本文件。
- 不要把 `.ai-index/**` 写入 `change_logs` 的功能要点、详细变动或涉及代码中。
- 查找已有能力时，优先读取 `reusable-map.md`，再读取具体源码。
- 修改 API、数据模型、配置、公共模块前，必须读取 `change-impact.md` 与 `dependency-map.md`。
- 本目录为生成物，除非明确要求，不要手工编辑；请通过索引脚本更新。

## 索引范围边界

- 进入索引：源码、测试、接口、数据模型、配置、脚本、真实项目文档、公共组件/工具/服务。
- 只作为规则入口：`AGENTS.md`、`CLAUDE.md`、`README.md` 等项目约束和说明文件。
- 永远排除：`.ai-index/**`、`change_logs/**`、`site_map.md`、`sitemap.md`、`sitemap.xml`、依赖目录、构建产物、缓存、日志、临时文件、二进制文件。

## 项目概况

- 索引版本：1.1.0
- 生成时间：2026-10-26T23:56:33.488Z
- Git 分支：未知
- Git HEAD：未知
- 暂存树：未知
- 识别技术栈：node/javascript-typescript
- 已索引文件数：272
- 本次更新模式：update
- 本次变更文件数：272

## 关键项目文件

- `AGENTS.md`
- `README.md`
- `package-lock.json`
- `package.json`

## 本次索引更新涉及文件

| 状态 | 路径 | 旧路径 |
| --- | --- | --- |
| SCAN | .gitignore |  |
| SCAN | AGENTS.md |  |
| SCAN | LICENSE |  |
| SCAN | README.md |  |
| SCAN | README.zh-CN.md |  |
| SCAN | THIRD-PARTY-NOTICES.md |  |
| SCAN | docs/software-company/PLAN.md |  |
| SCAN | docs/software-company/PRD.md |  |
| SCAN | docs/software-company/review-ledger.jsonl |  |
| SCAN | docs/software-company/review-scope-r1.json |  |
| SCAN | docs/software-company/review-scope-r2.json |  |
| SCAN | docs/software-company/review-scope-r3.json |  |
| SCAN | docs/software-company/review-scope-r4.json |  |
| SCAN | docs/software-company/review-scope-r5.json |  |
| SCAN | docs/software-company/review-scope-r6.json |  |
| SCAN | docs/software-company/review-scope-r7.json |  |
| SCAN | docs/software-company/review-scope-r8.json |  |
| SCAN | package-lock.json |  |
| SCAN | package.json |  |
| SCAN | reference/README.md |  |
| SCAN | reference/java/LICENSE.apache2.txt |  |
| SCAN | reference/java/apollo-client-sources/META-INF/MANIFEST.MF |  |
| SCAN | reference/java/apollo-client-sources/META-INF/additional-spring-configuration-metadata.json |  |
| SCAN | reference/java/apollo-client-sources/META-INF/apollo-1.0.0.xsd |  |
| SCAN | reference/java/apollo-client-sources/META-INF/maven/com.ctrip.framework.apollo/apollo-client/pom.properties |  |
| SCAN | reference/java/apollo-client-sources/META-INF/maven/com.ctrip.framework.apollo/apollo-client/pom.xml |  |
| SCAN | reference/java/apollo-client-sources/META-INF/services/com.ctrip.framework.apollo.core.spi.MetaServerProvider |  |
| SCAN | reference/java/apollo-client-sources/META-INF/services/com.ctrip.framework.apollo.internals.Injector |  |
| SCAN | reference/java/apollo-client-sources/META-INF/services/com.ctrip.framework.apollo.spi.ConfigServiceLoadBalancerClient |  |
| SCAN | reference/java/apollo-client-sources/META-INF/services/com.ctrip.framework.apollo.spring.spi.ApolloConfigRegistrarHelper |  |
| SCAN | reference/java/apollo-client-sources/META-INF/services/com.ctrip.framework.apollo.spring.spi.ConfigPropertySourcesProcessorHelper |  |
| SCAN | reference/java/apollo-client-sources/META-INF/services/com.ctrip.framework.apollo.tracer.spi.MessageProducerManager |  |
| SCAN | reference/java/apollo-client-sources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports |  |
| SCAN | reference/java/apollo-client-sources/META-INF/spring.factories |  |
| SCAN | reference/java/apollo-client-sources/META-INF/spring.handlers |  |
| SCAN | reference/java/apollo-client-sources/META-INF/spring.schemas |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/Config.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigChangeListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigFileChangeListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigService.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/PropertiesCompatibleConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/enums/ConfigSourceType.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/enums/PropertyChangeType.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/exceptions/ApolloConfigException.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/exceptions/ApolloConfigStatusCodeException.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/AbstractConfig.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/AbstractConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/AbstractConfigRepository.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigManager.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigMonitorInitializer.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigRepository.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigServiceLocator.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/DefaultConfig.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/DefaultConfigManager.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/DefaultInjector.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/DefaultMetaServerProvider.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/Injector.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/InterestedConfigChangeEvent.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/JsonConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/K8sConfigMapConfigRepository.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/LocalFileConfigRepository.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/PlainTextConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/PropertiesCompatibleFileConfigRepository.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/PropertiesConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/RemoteConfigLongPollService.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/RemoteConfigRepository.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/RepositoryChangeListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/SimpleConfig.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/TxtConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/XmlConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/YamlConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/YmlConfigFile.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/kubernetes/KubernetesManager.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/model/ConfigChange.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/model/ConfigChangeEvent.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/model/ConfigFileChangeEvent.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientBootstrapArgsMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientExceptionMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientNamespaceMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientThreadPoolMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ConfigMonitor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/ApolloClientMonitorConstant.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/ApolloClientMonitorContext.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/DefaultConfigMonitor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/enums/MetricTypeEnums.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/event/ApolloClientMonitorEvent.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/event/ApolloClientMonitorEventFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/event/ApolloClientMonitorEventPublisher.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/exporter/AbstractApolloClientMetricsExporter.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/exporter/ApolloClientMetricsExporter.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/exporter/ApolloClientMetricsExporterFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/exporter/impl/DefaultApolloClientMetricsExporterFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/exporter/impl/NullApolloClientMetricsExporter.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/jmx/ApolloClientJmxMBeanRegister.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/jmx/mbean/ApolloClientJmxBootstrapArgsMBean.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/jmx/mbean/ApolloClientJmxExceptionMBean.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/jmx/mbean/ApolloClientJmxNamespaceMBean.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/jmx/mbean/ApolloClientJmxThreadPoolMBean.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/AbstractApolloClientMonitorEventListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/ApolloClientMonitorEventListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientBootstrapArgsApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientExceptionApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientNamespaceApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientThreadPoolApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientBootstrapArgsMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientExceptionMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientNamespaceMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientThreadPoolMonitorApi.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/model/CounterModel.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/model/GaugeModel.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/model/SampleModel.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/tracer/ApolloClientMessageProducerComposite.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/tracer/ApolloClientMessageProducerManager.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/tracer/ApolloClientMonitorMessageProducer.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ApolloInjectorCustomizer.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigFactoryManager.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigRegistry.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigServiceLoadBalancerClient.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/DefaultConfigFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/DefaultConfigFactoryManager.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/DefaultConfigRegistry.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/RandomConfigServiceLoadBalancerClient.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloAnnotationProcessor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloConfig.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloConfigChangeListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloConfigRegistrar.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloJsonValue.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloProcessor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/EnableApolloConfig.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/MultipleConfig.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/SpringValueProcessor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/boot/ApolloApplicationContextInitializer.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/boot/ApolloAutoConfiguration.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/CachedCompositePropertySource.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/ConfigPropertySource.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/ConfigPropertySourceFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/ConfigPropertySourcesProcessor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/NamespaceHandler.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/PropertySourcesConstants.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/PropertySourcesProcessor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/events/ApolloConfigChangeEvent.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/package-info.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/AutoUpdateConfigChangeListener.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/PlaceholderHelper.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/SpringValue.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/SpringValueDefinition.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/SpringValueDefinitionProcessor.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/SpringValueRegistry.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/spi/ApolloConfigRegistrarHelper.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/spi/ConfigPropertySourcesProcessorHelper.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/spi/DefaultApolloConfigRegistrarHelper.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/spi/DefaultConfigPropertySourcesProcessorHelper.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/util/BeanRegistrationUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/util/PropertySourcesUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/util/SpringInjector.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/ConfigUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/ExceptionUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/OrderedProperties.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/date/DateUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/escape/EscapeUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/factory/DefaultPropertiesFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/factory/PropertiesFactory.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/function/Functions.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/http/DefaultHttpClient.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/http/HttpClient.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/http/HttpRequest.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/http/HttpResponse.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/http/HttpUtil.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/parser/ParserException.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/parser/Parsers.java |  |
| SCAN | reference/java/apollo-client-sources/com/ctrip/framework/apollo/util/yaml/YamlParser.java |  |
| SCAN | reference/java/apollo-core-sources/META-INF/MANIFEST.MF |  |
| SCAN | reference/java/apollo-core-sources/META-INF/maven/com.ctrip.framework.apollo/apollo-core/pom.properties |  |
| SCAN | reference/java/apollo-core-sources/META-INF/maven/com.ctrip.framework.apollo/apollo-core/pom.xml |  |
| SCAN | reference/java/apollo-core-sources/META-INF/services/com.ctrip.framework.apollo.core.spi.MetaServerProvider |  |
| SCAN | reference/java/apollo-core-sources/META-INF/services/com.ctrip.framework.apollo.tracer.spi.MessageProducerManager |  |
| SCAN | reference/java/apollo-core-sources/META-INF/services/com.ctrip.framework.foundation.spi.ProviderManager |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/Apollo.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/ApolloClientSystemConsts.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/ConfigConsts.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/MetaDomainConsts.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/ServiceNameConsts.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/dto/ApolloConfig.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/dto/ApolloConfigNotification.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/dto/ApolloNotificationMessages.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/dto/ConfigurationChange.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/dto/ServiceDTO.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/enums/ConfigFileFormat.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/enums/ConfigSyncType.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/enums/ConfigurationChangeType.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/enums/ConfigurationChangeTypeUtils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/enums/Env.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/enums/EnvUtils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/internals/LegacyMetaServerProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/schedule/ExponentialSchedulePolicy.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/schedule/SchedulePolicy.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/signature/HmacSha1Utils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/signature/Signature.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/spi/MetaServerProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/spi/Ordered.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/ApolloThreadFactory.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/ByteUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/ClassLoaderUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/DNSUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/DeferredLogCache.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/DeferredLogger.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/DeferredLoggerFactory.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/DeprecatedPropertyNotifyUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/MachineUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/NetUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/PropertiesUtil.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/ResourceUtils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/core/utils/StringUtils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/Tracer.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/DefaultMessageProducerManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/NullMessageProducer.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/NullMessageProducerManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/NullTransaction.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/cat/CatMessageProducer.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/cat/CatNames.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/internals/cat/CatTransaction.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/spi/MessageProducer.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/spi/MessageProducerManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/apollo/tracer/spi/Transaction.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/Foundation.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/DefaultProviderManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/NetworkInterfaceManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/NullProviderManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/ServiceBootstrap.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/Utils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/io/BOMInputStream.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/io/ByteOrderMark.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/io/IOUtils.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/io/ProxyInputStream.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/provider/DefaultApplicationProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/provider/DefaultNetworkProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/provider/DefaultServerProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/internals/provider/NullProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/spi/ProviderManager.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/spi/provider/ApplicationProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/spi/provider/NetworkProvider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/spi/provider/Provider.java |  |
| SCAN | reference/java/apollo-core-sources/com/ctrip/framework/foundation/spi/provider/ServerProvider.java |  |
| SCAN | src/cache.ts |  |
| SCAN | src/client.ts |  |
| SCAN | src/compat.ts |  |
| SCAN | src/discovery.ts |  |
| SCAN | src/errors.ts |  |
| SCAN | src/http.ts |  |
| SCAN | src/index.ts |  |
| SCAN | src/local-ip.ts |  |
| SCAN | src/secret.ts |  |
| SCAN | src/signature.ts |  |
| SCAN | src/watch.ts |  |
| SCAN | test/cache.test.js |  |
| SCAN | test/client.test.js |  |
| SCAN | test/compat.test.js |  |
| SCAN | test/discovery.test.js |  |
| SCAN | test/drop-in.test.js |  |
| SCAN | test/equivalence.test.js |  |
| SCAN | test/helpers/mock-server.js |  |
| SCAN | test/http.test.js |  |
| SCAN | test/local-ip.test.js |  |
| SCAN | test/package.test.js |  |
| SCAN | test/secret.test.js |  |
| SCAN | test/signature.test.js |  |
| SCAN | test/types/openapi.ts |  |
| SCAN | test/types.test.js |  |
| SCAN | test/watch.test.js |  |
| SCAN | tsconfig.json |  |


## 重点入口

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| config | package.json | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/Config.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigChangeListener.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigFileChangeListener.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/ConfigService.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/enums/ConfigSourceType.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/exceptions/ApolloConfigException.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/exceptions/ApolloConfigStatusCodeException.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/AbstractConfig.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/AbstractConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/AbstractConfigRepository.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigManager.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigMonitorInitializer.java | 项目配置、依赖、构建、运行时或工具链配置 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigRepository.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/ConfigServiceLocator.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/DefaultConfig.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/DefaultConfigManager.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/InterestedConfigChangeEvent.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/JsonConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/K8sConfigMapConfigRepository.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/LocalFileConfigRepository.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/PlainTextConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/PropertiesCompatibleFileConfigRepository.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/PropertiesConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/RemoteConfigLongPollService.java | 项目配置、依赖、构建、运行时或工具链配置 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/RemoteConfigRepository.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/RepositoryChangeListener.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/SimpleConfig.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/TxtConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/XmlConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/YamlConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/internals/YmlConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/model/ConfigChange.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/model/ConfigChangeEvent.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/model/ConfigFileChangeEvent.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientBootstrapArgsMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientExceptionMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientNamespaceMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ApolloClientThreadPoolMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/api/ConfigMonitor.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/DefaultConfigMonitor.java | 项目配置、依赖、构建、运行时或工具链配置 |
| entry | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/jmx/mbean/ApolloClientJmxBootstrapArgsMBean.java | 应用启动、主入口或初始化流程 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientBootstrapArgsApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientExceptionApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientNamespaceApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/DefaultApolloClientThreadPoolApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientBootstrapArgsMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientExceptionMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientNamespaceMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| api | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/listener/impl/NullClientThreadPoolMonitorApi.java | 接口、路由、控制器、RPC 或消息入口相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/model/CounterModel.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/model/GaugeModel.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| data | reference/java/apollo-client-sources/com/ctrip/framework/apollo/monitor/internal/model/SampleModel.java | 数据模型、持久化、Schema、迁移或查询相关文件 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/PropertiesCompatibleConfigFile.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigFactory.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigFactoryManager.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigRegistry.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/ConfigServiceLoadBalancerClient.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/DefaultConfigFactory.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/DefaultConfigFactoryManager.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/DefaultConfigRegistry.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spi/RandomConfigServiceLoadBalancerClient.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloConfig.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloConfigChangeListener.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/ApolloConfigRegistrar.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/EnableApolloConfig.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/annotation/MultipleConfig.java | 项目配置、依赖、构建、运行时或工具链配置 |
| entry | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/boot/ApolloApplicationContextInitializer.java | 应用启动、主入口或初始化流程 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/boot/ApolloAutoConfiguration.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/CachedCompositePropertySource.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/ConfigPropertySource.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/ConfigPropertySourceFactory.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/ConfigPropertySourcesProcessor.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/NamespaceHandler.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/PropertySourcesConstants.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/config/PropertySourcesProcessor.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/events/ApolloConfigChangeEvent.java | 项目配置、依赖、构建、运行时或工具链配置 |
| config | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/AutoUpdateConfigChangeListener.java | 项目配置、依赖、构建、运行时或工具链配置 |
| reusable | reference/java/apollo-client-sources/com/ctrip/framework/apollo/spring/property/PlaceholderHelper.java | 可复用公共能力、组件、工具、服务或共享模块 |


## 模块概览

| 模块 | 文件数 | 角色分布 |
| --- | --- | --- |
| docs | 11 | docs: 11 |
| internal/ApolloClientMonitorConstant.java | 1 | source: 1 |
| internal/ApolloClientMonitorContext.java | 1 | source: 1 |
| internal/DefaultConfigMonitor.java | 1 | config: 1 |
| internal/enums | 1 | source: 1 |
| internal/event | 3 | source: 3 |
| internal/exporter | 5 | source: 5 |
| internal/jmx | 5 | source: 4，entry: 1 |
| internal/listener | 10 | api: 8，source: 2 |
| internal/model | 3 | data: 3 |
| internal/tracer | 3 | source: 3 |
| reference | 184 | reusable: 79，config: 66，source: 16，data: 11，api: 5，other: 5，entry: 1，docs: 1 |
| root | 9 | docs: 4，other: 3，config: 2 |
| services/com.ctrip.framework.apollo.core.spi.MetaServerProvider | 2 | reusable: 2 |
| services/com.ctrip.framework.apollo.internals.Injector | 1 | reusable: 1 |
| services/com.ctrip.framework.apollo.spi.ConfigServiceLoadBalancerClient | 1 | config: 1 |
| services/com.ctrip.framework.apollo.spring.spi.ApolloConfigRegistrarHelper | 1 | config: 1 |
| services/com.ctrip.framework.apollo.spring.spi.ConfigPropertySourcesProcessorHelper | 1 | config: 1 |
| services/com.ctrip.framework.apollo.tracer.spi.MessageProducerManager | 2 | reusable: 2 |
| services/com.ctrip.framework.foundation.spi.ProviderManager | 1 | reusable: 1 |
| src/cache.ts | 1 | source: 1 |
| src/client.ts | 1 | source: 1 |
| src/compat.ts | 1 | source: 1 |
| src/discovery.ts | 1 | source: 1 |
| src/errors.ts | 1 | source: 1 |
| src/http.ts | 1 | source: 1 |
| src/index.ts | 1 | entry: 1 |
| src/local-ip.ts | 1 | source: 1 |
| src/secret.ts | 1 | source: 1 |
| src/signature.ts | 1 | source: 1 |
| src/watch.ts | 1 | source: 1 |
| test | 15 | test: 15 |


## 索引文件导航

- `project-summary.md`：项目概览与技术栈识别
- `module-map.md`：模块职责索引
- `file-map.md`：文件级索引
- `api-map.md`：API / 路由 / RPC / 消息入口
- `data-map.md`：数据模型 / Schema / 迁移 / 持久化
- `config-map.md`：配置、依赖、构建、运行时文件
- `script-map.md`：脚本、CLI、自动化任务
- `test-map.md`：测试入口与测试文件
- `reusable-map.md`：公共方法、组件、工具、服务、共享模块
- `dependency-map.md`：文件依赖与 imports/exports
- `change-impact.md`：变更影响范围判断规则
- `conventions.md`：通用 Agent 约束与项目规范入口
- `risks.md`：高风险区域和注意事项
- `symbols/*.json`：函数、类、方法、导入导出等机器可读符号索引

## 生成文件

- `.ai-index/project-summary.md`
- `.ai-index/module-map.md`
- `.ai-index/file-map.md`
- `.ai-index/api-map.md`
- `.ai-index/data-map.md`
- `.ai-index/config-map.md`
- `.ai-index/script-map.md`
- `.ai-index/test-map.md`
- `.ai-index/reusable-map.md`
- `.ai-index/dependency-map.md`
- `.ai-index/change-impact.md`
- `.ai-index/conventions.md`
- `.ai-index/risks.md`
- `.ai-index/recent-changes.md`
- `.ai-index/symbols/functions.json`
- `.ai-index/symbols/classes.json`
- `.ai-index/symbols/methods.json`
- `.ai-index/symbols/imports.json`
- `.ai-index/symbols/exports.json`
- `.ai-index/symbols/references.json`
