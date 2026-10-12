#import <Cocoa/Cocoa.h>
#import <EventKit/EventKit.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <fcntl.h>
#import <unistd.h>
#import <sys/stat.h>

static NSError *Failure(NSString *message) { return [NSError errorWithDomain:@"AgentReminders.SectionExport" code:1 userInfo:@{NSLocalizedDescriptionKey:message}]; }
static NSString *SafeException(NSException *exception) { return [@[@"UnsupportedSource",@"InvalidSourceID",@"NSInvalidArgumentException",@"NSInternalInconsistencyException"] containsObject:exception.name]?exception.name:@"native-exception"; }
static NSString *SafeError(NSError *error) { return [NSString stringWithFormat:@"%@:%ld",[@[@"NSCocoaErrorDomain",@"NSPOSIXErrorDomain",@"NSOSStatusErrorDomain",@"REMErrorDomain",@"com.apple.reminders"] containsObject:error.domain]?error.domain:@"native-domain",(long)error.code]; }
static void Stage(NSString *phase) {
    // Only authored phase names are written; no record values, identifiers or exception reasons.
    NSURL *file=[NSBundle.mainBundle.bundleURL.URLByDeletingLastPathComponent URLByAppendingPathComponent:@"section-export-stage.txt"];
    int descriptor=open(file.fileSystemRepresentation,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW|O_CLOEXEC,0600);
    if(descriptor<0)return;
    if(!fchmod(descriptor,0600)){NSData *data=[phase dataUsingEncoding:NSUTF8StringEncoding];write(descriptor,data.bytes,data.length);}
    close(descriptor);
}
static BOOL Bound(NSString *value, NSUInteger bytes) { return [value isKindOfClass:NSString.class] && value.length > 0 && [value lengthOfBytesUsingEncoding:NSUTF8StringEncoding] <= bytes; }
// Only these read selectors are admitted. No save/change-item/daemon configuration API is used.
static NSSet *ReadSelectors(void) { return [NSSet setWithArray:@[@"remObjectID", @"uuid", @"name", @"displayName", @"sectionContext", @"reminderIDsOrdering", @"fetchRemindersAndSubtasksWithError:", @"fetchListsForEventKitBridgingWithError:", @"fetchListSectionsForListSectionContext:error:", @"fetchListSectionWithReminderID:error:"]]; }
static id Read(id object, NSString *name) {
    if (![ReadSelectors() containsObject:name] || [name containsString:@":"] || ![object respondsToSelector:NSSelectorFromString(name)]) @throw [NSException exceptionWithName:@"UnsupportedSource" reason:nil userInfo:nil];
    SEL selector=NSSelectorFromString(name);id signatureTarget=object;
    NSMethodSignature *signature=[signatureTarget methodSignatureForSelector:selector];
    // ReminderKit's declared dynamic getters forward to storage objects.
    for(NSUInteger hop=0;!signature&&hop<2;hop++){id target=[signatureTarget forwardingTargetForSelector:selector];if(!target||target==signatureTarget)break;signatureTarget=target;signature=[target methodSignatureForSelector:selector];}
    if (signature.numberOfArguments != 2 || signature.methodReturnType[0] != '@') @throw [NSException exceptionWithName:@"UnsupportedSource" reason:nil userInfo:@{@"method":name}];
    return ((id(*)(id,SEL))objc_msgSend)(object,NSSelectorFromString(name));
}
static id Fetch(id object, NSString *name, id argument, NSError **error) {
    if (![ReadSelectors() containsObject:name] || ![object respondsToSelector:NSSelectorFromString(name)]) { *error=Failure(@"This macOS version does not expose the required read-only section metadata."); return nil; }
    NSMethodSignature *signature=[object methodSignatureForSelector:NSSelectorFromString(name)];
    NSUInteger count=argument?4:3;
    if (signature.numberOfArguments != count || signature.methodReturnType[0] != '@' || strcmp([signature getArgumentTypeAtIndex:count-1],"^@") || (argument && [signature getArgumentTypeAtIndex:2][0]!='@')) { *error=Failure(@"The native read-only interface changed. Nothing was exported."); return nil; }
    return argument ? ((id(*)(id,SEL,id,NSError **))objc_msgSend)(object,NSSelectorFromString(name),argument,error) : ((id(*)(id,SEL,NSError **))objc_msgSend)(object,NSSelectorFromString(name),error);
}
static NSString *UUIDString(id objectID) {
    id uuid=Read(objectID,@"uuid");
    if (![uuid isKindOfClass:NSUUID.class]) @throw [NSException exceptionWithName:@"InvalidSourceID" reason:nil userInfo:nil];
    return [uuid UUIDString].lowercaseString;
}
static NSString *EventKitUUID(NSString *value) {
    NSUUID *uuid=[[NSUUID alloc] initWithUUIDString:value];
    if (!uuid) {
        NSURL *url=[NSURL URLWithString:value];
        if ([url.scheme isEqualToString:@"x-apple-reminderkit"] && [@[@"REMList",@"REMReminder"] containsObject:url.host]) uuid=[[NSUUID alloc] initWithUUIDString:url.lastPathComponent];
    }
    return uuid.UUIDString.lowercaseString;
}
static NSDictionary *SectionMetadata(id list, id store, id view, NSError **error) {
    @try {
        NSArray *source=Fetch(store,@"fetchListSectionsForListSectionContext:error:",Read(list,@"sectionContext"),error);
        if (!source || *error) return nil;
        if (![source isKindOfClass:NSArray.class] || source.count > 200) { *error=Failure(@"The selected section metadata is unsupported or too large."); return nil; }
        NSMutableArray *sections=[NSMutableArray array]; NSMutableSet *sectionIDs=[NSMutableSet set];
        for(id section in source) {
            NSString *identifier=UUIDString(Read(section,@"remObjectID")), *title=Read(section,@"displayName");
            if (!Bound(title,200) || [sectionIDs containsObject:identifier]) { *error=Failure(@"Section names or identities cannot be preserved safely."); return nil; }
            [sections addObject:@{@"id":identifier,@"title":title}]; [sectionIDs addObject:identifier];
        }
        id ordering=Read(list,@"reminderIDsOrdering");
        if (![ordering isKindOfClass:NSOrderedSet.class]) { *error=Failure(@"Native reminder ordering is unavailable. Nothing was exported."); return nil; }
        NSArray *reminders=Fetch(list,@"fetchRemindersAndSubtasksWithError:",nil,error);
        if (!reminders || *error) return nil;
        if (![reminders isKindOfClass:NSArray.class] || reminders.count > 5000) { *error=Failure(@"Choose a smaller list."); return nil; }
        NSMutableDictionary *memberships=[NSMutableDictionary dictionary]; NSMutableSet *reminderIDs=[NSMutableSet set];
        for(id reminder in reminders) {
            id objectID=Read(reminder,@"remObjectID"); NSString *identifier=UUIDString(objectID);
            if ([reminderIDs containsObject:identifier]) { *error=Failure(@"The selected list changed. Preview again."); return nil; }
            [reminderIDs addObject:identifier];
            id section=Fetch(view,@"fetchListSectionWithReminderID:error:",objectID,error);
            if (*error) return nil;
            NSString *sectionID=section?UUIDString(Read(section,@"remObjectID")):nil;
            if (sectionID && ![sectionIDs containsObject:sectionID]) { *error=Failure(@"A reminder references an unavailable section. Nothing was exported."); return nil; }
            memberships[identifier]=sectionID?:NSNull.null;
        }
        NSMutableArray *ordered=[NSMutableArray array];
        for(id objectID in ordering) { NSString *identifier=UUIDString(objectID); if ([reminderIDs containsObject:identifier]) [ordered addObject:identifier]; }
        if (ordered.count != reminderIDs.count || [NSSet setWithArray:ordered].count != ordered.count) { *error=Failure(@"Native ordering does not cover every reminder. Nothing was exported."); return nil; }
        return @{@"sections":sections,@"membership":memberships,@"order":ordered};
    } @catch(NSException *exception) { *error=Failure(@"This macOS version cannot provide complete section metadata. Nothing was exported."); return nil; }
}
static NSDictionary *DateComponents(NSDateComponents *value) {
    if(!value)return nil;
    NSMutableDictionary *result=[NSMutableDictionary dictionary];
    if(value.year != NSDateComponentUndefined)result[@"year"]=@(value.year);
    if(value.month != NSDateComponentUndefined)result[@"month"]=@(value.month);
    if(value.day != NSDateComponentUndefined)result[@"day"]=@(value.day);
    if(value.hour != NSDateComponentUndefined)result[@"hour"]=@(value.hour);
    if(value.minute != NSDateComponentUndefined)result[@"minute"]=@(value.minute);
    if(value.second != NSDateComponentUndefined)result[@"second"]=@(value.second);
    if(value.calendar)result[@"calendarID"]=value.calendar.calendarIdentifier;
    if(value.era != NSDateComponentUndefined)result[@"era"]=@(value.era);
    if(value.timeZone)result[@"timeZone"]=value.timeZone.name;
    result[@"floating"]=@(value.hour != NSDateComponentUndefined && !value.timeZone);
    return result;
}
static BOOL SavePrivateData(NSData *data,NSURL *destination) {
    int file=open(destination.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
    if(file<0)return NO;
    const unsigned char *bytes=data.bytes;NSUInteger written=0;BOOL saved=YES;
    while(written<data.length){ssize_t count=write(file,bytes+written,data.length-written);if(count<=0){saved=NO;break;}written+=(NSUInteger)count;}
    if(fsync(file))saved=NO;
    if(close(file))saved=NO;
    if(!saved)unlink(destination.fileSystemRepresentation);
    return saved;
}
@interface ExportApp : NSObject <NSApplicationDelegate>
@property EKEventStore *events;
@property id nativeStore;
@property id sectionsView;
@property NSWindow *window;
@property NSStackView *choices;
@property NSArray *nativeLists;
@property NSDictionary *calendars;
@property NSMutableArray<NSButton *> *checkboxes;
@end
@implementation ExportApp
- (void)alert:(NSString *)message { NSAlert *alert=[[NSAlert alloc]init]; alert.messageText=@"Section Export"; alert.informativeText=message; [alert addButtonWithTitle:@"OK"]; [alert runModal]; }
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    Stage(@"introduction");
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular]; [NSApp activateIgnoringOtherApps:YES];
    NSAlert *consent=[[NSAlert alloc]init];consent.messageText=@"Export Original Reminders Sections";
    consent.informativeText=@"This local Mac helper reads only the lists you select. Apple’s public API omits sections, so this helper uses macOS’s private, read-only Reminders interface. It can stop working after an OS update. It does not edit Apple Reminders, upload data, or read Apple ID credentials. Apple will ask for Reminders permission. You review a preview before saving a private import file.";
    [consent addButtonWithTitle:@"Continue"];[consent addButtonWithTitle:@"Cancel"];
    if([consent runModal]!=NSAlertFirstButtonReturn){[NSApp terminate:nil];return;}
    Stage(@"public-permission-awaiting-owner");self.events=[[EKEventStore alloc]init];
    [self.events requestFullAccessToRemindersWithCompletion:^(BOOL granted,NSError *error){dispatch_async(dispatch_get_main_queue(),^{if(!granted||error){Stage(@"public-permission-denied");[self alert:@"Reminders permission was not granted. No lists were read."];[NSApp terminate:nil];return;}Stage(@"public-permission-granted");[self loadLists];});}];
}
- (void)loadLists {
    NSString *stage=@"framework-load";
    @try {
        if(!dlopen("/System/Library/PrivateFrameworks/ReminderKit.framework/Versions/A/ReminderKit",RTLD_LAZY)){[self alert:@"The local Reminders framework is unavailable."];return;}
        stage=@"class-binding";Class storeClass=NSClassFromString(@"REMStore"), viewClass=NSClassFromString(@"REMListSectionsDataView");
        if(!storeClass||!viewClass){[self alert:@"This macOS version is unsupported."];return;}
        stage=@"store-init";Stage(stage);self.nativeStore=[[storeClass alloc]init];
        SEL constructor=NSSelectorFromString(@"initWithStore:");
        if(![viewClass instancesRespondToSelector:constructor]){[self alert:@"This macOS version is unsupported."];return;}
        stage=@"data-view-init";self.sectionsView=((id(*)(id,SEL,id))objc_msgSend)([viewClass alloc],constructor,self.nativeStore);
        stage=@"list-fetch";Stage(stage);
        NSError *error=nil;NSArray *lists=Fetch(self.nativeStore,@"fetchListsForEventKitBridgingWithError:",nil,&error);
        if(error||![lists isKindOfClass:NSArray.class]){NSString *failure=[NSString stringWithFormat:@"list-fetch-failed/%@",error?SafeError(error):NSStringFromClass(lists.class)?:@"nil-result"];Stage(failure);[self alert:[NSString stringWithFormat:@"The native list interface is unavailable (%@). Nothing was exported; no permissions or entitlements will be bypassed.",failure]];return;}
        stage=@"calendar-identifier-crosswalk";
        NSMutableDictionary *calendars=[NSMutableDictionary dictionary];
        for(EKCalendar *calendar in [self.events calendarsForEntityType:EKEntityTypeReminder]){NSString *uuid=EventKitUUID(calendar.calendarIdentifier);if(uuid){if(calendars[uuid]){[self alert:@"Calendar identifiers are ambiguous. Nothing was exported."];return;}calendars[uuid]=calendar;}}
        NSMutableArray *matched=[NSMutableArray array];
        stage=@"list-identifier-crosswalk";Stage(stage);for(id list in lists){NSString *uuid=UUIDString(Read(list,@"remObjectID"));if(calendars[uuid])[matched addObject:list];}
        self.nativeLists=matched;self.calendars=calendars;
        self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,540,520) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"Choose Reminders Lists";[self.window center];
        NSScrollView *scroll=[[NSScrollView alloc]initWithFrame:NSMakeRect(20,80,500,410)];scroll.hasVerticalScroller=YES;
        self.choices=[[NSStackView alloc]initWithFrame:NSMakeRect(0,0,475,MAX(390,matched.count*32))];self.choices.orientation=NSUserInterfaceLayoutOrientationVertical;self.choices.alignment=NSLayoutAttributeLeading;self.choices.spacing=8;
        self.checkboxes=[NSMutableArray array];
        stage=@"list-name-read";Stage(stage);for(id list in matched){NSString *name=Read(list,@"name");if(!Bound(name,512))continue;NSButton *button=[NSButton checkboxWithTitle:@"Private list — reveal names yourself" target:nil action:nil];button.enabled=NO;[self.choices addArrangedSubview:button];[self.checkboxes addObject:button];}
        if(self.checkboxes.count!=matched.count){[self alert:@"A list name cannot be represented safely. Nothing was exported."];return;}
        scroll.documentView=self.choices;[self.window.contentView addSubview:scroll];
        NSButton *reveal=[NSButton buttonWithTitle:@"Reveal Private List Names" target:self action:@selector(reveal:)];reveal.frame=NSMakeRect(20,22,240,36);[self.window.contentView addSubview:reveal];
        NSButton *preview=[NSButton buttonWithTitle:@"Preview Selected Lists…" target:self action:@selector(preview:)];preview.frame=NSMakeRect(285,22,225,36);[self.window.contentView addSubview:preview];
        Stage(@"chooser-ready-names-masked");[self.window makeKeyAndOrderFront:nil];
    } @catch(NSException *exception){NSString *failure=[NSString stringWithFormat:@"%@/%@%@",stage,SafeException(exception),[ReadSelectors() containsObject:exception.userInfo[@"method"]]?[NSString stringWithFormat:@"/%@",exception.userInfo[@"method"]]:@""];Stage(failure);[self alert:[NSString stringWithFormat:@"The native interface is unavailable (%@). Nothing was exported.",failure]];}
}
- (void)reveal:(NSButton *)sender {
    @try { for(NSUInteger index=0;index<self.checkboxes.count;index++){self.checkboxes[index].title=Read(self.nativeLists[index],@"name");self.checkboxes[index].enabled=YES;}sender.enabled=NO; }
    @catch(NSException *exception){[self alert:@"The list interface changed. Nothing was exported."];}
}
- (void)preview:(id)sender {
    if([EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder]!=EKAuthorizationStatusFullAccess){[self alert:@"Reminders permission is no longer enabled. No source metadata was read."];return;}
    NSMutableArray *selected=[NSMutableArray array];
    [self.checkboxes enumerateObjectsUsingBlock:^(NSButton *button,NSUInteger index,BOOL *stop){if(button.state==NSControlStateValueOn)[selected addObject:self.nativeLists[index]];}];
    if(!selected.count||selected.count>100){[self alert:@"Choose between 1 and 100 lists."];return;}
    NSMutableArray *listRows=[NSMutableArray array],*reminderRows=[NSMutableArray array],*descriptions=[NSMutableArray array],*selectedIDs=[NSMutableArray array];
    __block BOOL failed=NO;dispatch_group_t group=dispatch_group_create();
    for(id list in selected){
        NSError *error=nil;NSDictionary *metadata=SectionMetadata(list,self.nativeStore,self.sectionsView,&error);
        if(!metadata||error){[self alert:[error.domain isEqualToString:@"AgentReminders.SectionExport"]?error.localizedDescription:[NSString stringWithFormat:@"The native section interface is unavailable (%@). Nothing was exported.",SafeError(error)]];return;}
        NSString *listID=UUIDString(Read(list,@"remObjectID"));EKCalendar *calendar=self.calendars[listID];
        NSArray *sections=metadata[@"sections"];
        [listRows addObject:@{@"id":listID,@"title":calendar.title,@"writable":@(calendar.allowsContentModifications),@"sections":sections}];[selectedIDs addObject:listID];
        [descriptions addObject:[NSString stringWithFormat:@"%@ — %lu sections, %lu reminders\n%@",calendar.title,(unsigned long)sections.count,(unsigned long)[metadata[@"order"] count],[[sections valueForKey:@"title"] componentsJoinedByString:@" → "]]];
        dispatch_group_enter(group);
        [self.events fetchRemindersMatchingPredicate:[self.events predicateForRemindersInCalendars:@[calendar]] completion:^(NSArray<EKReminder *> *rows){
            dispatch_async(dispatch_get_main_queue(),^{
                NSMutableDictionary *byID=[NSMutableDictionary dictionary];
                for(EKReminder *row in rows){NSString *uuid=EventKitUUID(row.calendarItemIdentifier);if(!uuid||byID[uuid]||!Bound(row.title,1024)){failed=YES;break;}byID[uuid]=row;}
                if(!rows||rows.count!=[metadata[@"order"] count])failed=YES;
                for(NSString *uuid in metadata[@"order"]){
                    EKReminder *row=byID[uuid];if(!row){failed=YES;break;}
                    NSMutableDictionary *record=[@{@"id":uuid,@"listID":listID,@"title":row.title,@"completed":@(row.completed),@"priority":@(row.priority),@"recurring":@(row.hasRecurrenceRules),@"sectionID":metadata[@"membership"][uuid]} mutableCopy];
                    if(row.calendarItemExternalIdentifier)record[@"externalID"]=row.calendarItemExternalIdentifier;
                    if(row.notes)record[@"notes"]=row.notes;if(row.URL)record[@"url"]=row.URL.absoluteString;
                    if(row.completionDate)record[@"completionDate"]=@(floor(row.completionDate.timeIntervalSince1970*1000));
                    if(row.lastModifiedDate)record[@"modifiedAt"]=@(floor(row.lastModifiedDate.timeIntervalSince1970*1000));
                    if(row.dueDateComponents)record[@"due"]=DateComponents(row.dueDateComponents);
                    if(row.startDateComponents)record[@"start"]=DateComponents(row.startDateComponents);
                    [reminderRows addObject:record];
                }
                dispatch_group_leave(group);
            });
        }];
    }
    dispatch_group_notify(group,dispatch_get_main_queue(),^{
        if([EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder]!=EKAuthorizationStatusFullAccess){[self alert:@"Reminders permission is no longer enabled. Nothing was exported."];return;}
        if(failed||reminderRows.count>5000){[self alert:@"The original reminder identities/order could not be matched exactly, or the selection is too large. Nothing was exported; no title matching was used."];return;}
        // Re-read selected section metadata after EventKit finishes; source changes invalidate the preview.
        for(NSUInteger index=0;index<selected.count;index++){
            NSError *error=nil;NSDictionary *fresh=SectionMetadata(selected[index],self.nativeStore,self.sectionsView,&error);
            NSArray *expected=[reminderRows filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *record,NSDictionary *bindings){return [record[@"listID"] isEqual:selectedIDs[index]];}]];
            if(error||![fresh[@"sections"] isEqual:listRows[index][@"sections"]]||![fresh[@"order"] isEqual:[expected valueForKey:@"id"]]){[self alert:@"The source changed during preview. Preview again."];return;}
            for(NSDictionary *record in expected)if(![fresh[@"membership"][record[@"id"]] isEqual:record[@"sectionID"]]){[self alert:@"Section membership changed during preview. Preview again."];return;}
        }
        NSDictionary *snapshot=@{@"schemaVersion":@1,@"generatedAt":@(floor(NSDate.date.timeIntervalSince1970*1000)),@"sample":@NO,@"selectedListIDs":selectedIDs,@"lists":listRows,@"reminders":reminderRows,@"unsupportedFeatures":@[@"tags",@"subtasks",@"flags",@"photos",@"assignment",@"smartListDefinitions",@"recurrenceRules",@"alarms"]};
        NSAlert *preview=[[NSAlert alloc]init];preview.messageText=@"Review Original Sections";preview.informativeText=[NSString stringWithFormat:@"%@\n\nThe export contains your private reminder text. Save it privately, import it through Accounts → iCloud → Import from iPhone, and delete the file afterward. Nothing is uploaded or edited here.",[descriptions componentsJoinedByString:@"\n\n"]];[preview addButtonWithTitle:@"Save Private Import…"];[preview addButtonWithTitle:@"Cancel"];
        if([preview runModal]!=NSAlertFirstButtonReturn)return;
        NSData *data=[NSJSONSerialization dataWithJSONObject:snapshot options:NSJSONWritingSortedKeys error:nil];if(!data||data.length>2*1024*1024){[self alert:@"The private import is too large. Nothing was exported."];return;}
        NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=@"reminders-sections-private.json";panel.directoryURL=[NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory inDomains:NSUserDomainMask].firstObject;
        if([panel runModal]!=NSModalResponseOK)return;
        NSURL *parent=panel.URL.URLByDeletingLastPathComponent;
        for(NSURL *check=parent;check.path.length>1;check=check.URLByDeletingLastPathComponent)if([NSFileManager.defaultManager fileExistsAtPath:[check URLByAppendingPathComponent:@".git"].path]){[self alert:@"Choose a private folder outside a Git repository."];return;}
        if(!SavePrivateData(data,panel.URL)){[self alert:@"Choose a new private filename. No existing file will be overwritten."];return;}
        [self alert:@"The private section-aware import is saved. Import it on your device; the original Apple reminders are unchanged."];
    });
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return NO;}
@end

// Synthetic native protocol tests. This branch never loads ReminderKit or creates EKEventStore.
@interface FakeID:NSObject @property NSUUID *uuid; @end
@implementation FakeID @end
@interface FakeSource:NSObject @property FakeID *remObjectID; @property NSString *displayName; @property NSOrderedSet *reminderIDsOrdering; @property NSArray *rows; @property NSArray *sections; @property NSDictionary *membership; @end
@implementation FakeSource
- (id)sectionContext{return self;}
- (id)fetchRemindersAndSubtasksWithError:(NSError **)error{return self.rows;}
- (id)fetchListSectionsForListSectionContext:(id)context error:(NSError **)error{return [context sections];}
- (id)fetchListSectionWithReminderID:(FakeID *)identifier error:(NSError **)error{return self.membership[identifier.uuid.UUIDString.lowercaseString];}
@end
@interface FakeNameStorage:NSObject @property NSString *name; @end
@implementation FakeNameStorage @end
@interface FakeForwarder:NSObject @property FakeNameStorage *storage; @end
@implementation FakeForwarder
- (BOOL)respondsToSelector:(SEL)selector{return [super respondsToSelector:selector]||[self.storage respondsToSelector:selector];}
- (id)forwardingTargetForSelector:(SEL)selector{return [self.storage respondsToSelector:selector]?self.storage:[super forwardingTargetForSelector:selector];}
@end
static FakeSource *Fake(NSString *uuid,NSString *title){FakeSource *row=[FakeSource new];row.remObjectID=[FakeID new];row.remObjectID.uuid=[[NSUUID alloc]initWithUUIDString:uuid];row.displayName=title;return row;}
static void SelfTest(void){
    FakeSource *list=[FakeSource new],*first=Fake(@"AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",@"Synthetic Section B"),*second=Fake(@"BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",@"Synthetic Section A"),*row=Fake(@"CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",@"Synthetic row");
    list.rows=@[row];list.sections=@[first,second];list.reminderIDsOrdering=[NSOrderedSet orderedSetWithArray:@[row.remObjectID]];list.membership=@{@"cccccccc-cccc-cccc-cccc-cccccccccccc":second};NSError *error=nil;NSDictionary *data=SectionMetadata(list,list,list,&error);
    NSCAssert(data && !error,@"Synthetic metadata reads");NSCAssert([data[@"sections"][0][@"title"] isEqual:@"Synthetic Section B"],@"Native source order preserved");NSCAssert([data[@"membership"][@"cccccccc-cccc-cccc-cccc-cccccccccccc"] isEqual:@"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],@"Original membership preserved");
    list.membership=@{};error=nil;data=SectionMetadata(list,list,list,&error);NSCAssert([data[@"membership"][@"cccccccc-cccc-cccc-cccc-cccccccccccc"] isEqual:NSNull.null],@"Explicitly sectionless preserved");
    list.sections=@[first,first];error=nil;NSCAssert(!SectionMetadata(list,list,list,&error)&&error,@"Duplicate sections reject");
    list.sections=@[first];list.membership=@{@"cccccccc-cccc-cccc-cccc-cccccccccccc":second};error=nil;NSCAssert(!SectionMetadata(list,list,list,&error)&&error,@"Foreign membership rejects");
    list.membership=@{};list.reminderIDsOrdering=[NSOrderedSet orderedSet];error=nil;NSCAssert(!SectionMetadata(list,list,list,&error)&&error,@"Incomplete source ordering rejects");
    NSCAssert(![ReadSelectors() containsObject:@"saveSaveRequest:"],@"Mutations never admitted");
    FakeForwarder *forwarder=[FakeForwarder new];forwarder.storage=[FakeNameStorage new];forwarder.storage.name=@"Synthetic forwarded name";
    NSCAssert(![forwarder methodSignatureForSelector:NSSelectorFromString(@"name")],@"Dynamic getter signature is absent on facade");
    NSCAssert([Read(forwarder,@"name") isEqual:@"Synthetic forwarded name"],@"Declared native dynamic getter validates through its storage signature");
    NSCAssert([EventKitUUID(@"x-apple-reminderkit://REMReminder/CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC") isEqual:@"cccccccc-cccc-cccc-cccc-cccccccccccc"],@"Exact UUID identity crosswalk");NSCAssert(!EventKitUUID(@"https://example.com/CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC"),@"Foreign URL identity rejected");
    NSURL *directory=[NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] isDirectory:YES];
    [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:NO attributes:@{NSFilePosixPermissions:@0700} error:nil];
    NSURL *destination=[directory URLByAppendingPathComponent:@"synthetic.json"];NSData *content=[@"Synthetic test data" dataUsingEncoding:NSUTF8StringEncoding];
    NSCAssert(SavePrivateData(content,destination),@"Private export saves synthetic bytes");
    NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:destination.path error:nil];NSCAssert([attributes[NSFilePosixPermissions] integerValue]==0600,@"Private export is owner-only from creation");
    NSCAssert(!SavePrivateData(content,destination),@"Existing private files are never overwritten");
    [NSFileManager.defaultManager removeItemAtURL:directory error:nil];
    puts("Mac section export: 15 synthetic checks passed. No EventKit, account or private-store access; synthetic temporary file removed.");
}
int main(int argc,const char **argv){@autoreleasepool{if(argc==2&&!strcmp(argv[1],"--self-test")){SelfTest();return 0;}NSApplication *app=NSApplication.sharedApplication;ExportApp *delegate=[ExportApp new];app.delegate=delegate;[app run];}return 0;}
