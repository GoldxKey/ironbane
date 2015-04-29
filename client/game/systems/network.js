angular
    .module('game.systems.network', [
        'ces',
        'three',
        'engine.entity-builder',
        'game.world-root',
        'engine.entity-cache',
        'ammo',
        'engine.timing'
    ])
    .factory('NetworkSystem', [
        'System',
        'EntityBuilder',
        '$log',
        '$rootScope',
        '$components',
        '$rootWorld',
        '$entityCache',
        'THREE',
        'Ammo',
        '$timing',
        function(System, EntityBuilder, $log, $rootScope, $components, $rootWorld, $entityCache, THREE, Ammo, $timing) {
            'use strict';

            function arraysAreEqual(a1, a2) {
                // TODO make more robust? this is just for transforms right now
                return (a1[0] === a2[0]) && (a1[1] === a2[1]) && (a1[2] === a2[2]);
            }

            var toSimpleRotationY = function(rotation) {
                var rotVec = new THREE.Vector3(0, 0, 1);
                rotVec.applyEuler(rotation);

                var simpleRotationY = (Math.atan2(rotVec.z, rotVec.x));
                if (simpleRotationY < 0) {
                    simpleRotationY += (Math.PI * 2);
                }
                simpleRotationY = (Math.PI * 2) - simpleRotationY;

                return simpleRotationY;
            };

            function onReceiveTransforms(packet) {
                var netEntities = this.world.getEntities('netRecv');

                // TODO: might be better instead to just find them by ID? not sure which search is faster
                // (and then test they have the netRecv component)
                netEntities.forEach(function(entity) {
                    if (packet[entity.uuid]) {
                        entity.position.deserialize(packet[entity.uuid].pos);
                        entity.rotation.deserialize(packet[entity.uuid].rot);
                    }

                    // stuff with rigidBody from network-receive script
                    var rigidBodyComponent = entity.getComponent('rigidBody');
                    if (rigidBodyComponent && rigidBodyComponent.rigidBody) {
                        var btVec3 = new Ammo.btVector3();
                        var btQuat = new Ammo.btQuaternion(0, 0, 0, 1);
                        var desiredPosition = new THREE.Vector3();
                        var desiredRotation = new THREE.Euler();

                        var toVec = desiredPosition.clone().sub(entity.position);
                        var currentVel = rigidBodyComponent.rigidBody.getLinearVelocity();
                        currentVel = currentVel.toTHREEVector3();
                        btVec3.setValue(toVec.x, currentVel.y, toVec.z);
                        rigidBodyComponent.rigidBody.setLinearVelocity(btVec3);
                        // rigidBodyComponent.rigidBody.applyCentralImpulse(btVec3);

                        if (toVec.lengthSq() > 16) {
                            btVec3.setValue(desiredPosition.x, desiredPosition.y, desiredPosition.z);
                            var btTransform = new Ammo.btTransform(btQuat, btVec3);
                            rigidBodyComponent.rigidBody.setWorldTransform(btTransform);
                        }

                        var entityRotationY = toSimpleRotationY(entity.rotation);
                        var desiredRotationY = toSimpleRotationY(desiredRotation);

                        var side = true;
                        if (desiredRotationY < entityRotationY) {
                            side = Math.abs(desiredRotationY - entityRotationY) < (Math.PI);
                        } else {
                            side = ((desiredRotationY - entityRotationY) > (Math.PI));
                        }

                        var distance = Math.abs(desiredRotationY - entityRotationY);

                        var speed = 2.0;

                        if (distance > 0.03) {
                            if (side) {
                                entity.rotateY(-speed * $timing.frameTime);
                            } else if (!side) {
                                entity.rotateY(speed * $timing.frameTime);
                            }
                        }
                    }
                });
            }

            function onStreamAdd(packet) {
                var world = this.world;

                angular.forEach(packet, function(entity, uuid) {
                    // TODO: should check that the uuid does not already exist
                    // actually not sure what will happen if THREE has 2 of them

                    // ok let's see what happens when we build it
                    var builtEntity = EntityBuilder.build(entity);

                    // test if this is the "main" player so we can enhance
                    if ($rootScope.currentUser._id === entity.owner) {
                        var scriptComponent = builtEntity.getComponent('script');
                        // Add all the stuff to make us a real player
                        builtEntity.addComponent($components.get('player'));
                        builtEntity.addComponent($components.get('collisionReporter'));
                        builtEntity.addComponent($components.get('light', {
                            type: 'PointLight',
                            color: 0x60511b,
                            distance: 3.5
                        }));
                        builtEntity.addComponent($components.get('camera', {
                            aspectRatio: $rootWorld.renderer.domElement.width / $rootWorld.renderer.domElement.height
                        }));
                        builtEntity.addComponent($components.get('rigidBody', {
                            shape: {
                                type: 'capsule',
                                width: 0.5,
                                height: 1.0,
                                depth: 0.5,
                                radius: 0.5

                                // type: 'sphere',
                                // radius: 0.5
                            },
                            mass: 1,
                            friction: 0.0,
                            restitution: 0,
                            allowSleep: false,
                            lock: {
                                position: {
                                    x: false,
                                    y: false,
                                    z: false
                                },
                                rotation: {
                                    x: true,
                                    y: true,
                                    z: true
                                }
                            }
                        }));

                        if (scriptComponent) {
                            scriptComponent.scripts = scriptComponent.scripts.concat([
                                '/scripts/built-in/character-controller.js',
                                '/scripts/built-in/character-multicam.js',
                            ]);
                        }

                        // this is pretty much the only one we want to netSend
                        builtEntity.addComponent($components.get('netSend'));

                        $entityCache.put('mainPlayer', builtEntity);
                        // needed somewhere on the scope for the UI, prolly doesn't *need* to be root
                        $rootScope.mainPlayer = builtEntity;
                    } else {
                        // other stuff we should recv
                        builtEntity.addComponent($components.get('netRecv'));
                    }

                    world.addEntity(builtEntity);

                    $log.debug('[NetworkSystem : add]', entity, builtEntity);
                });

                $rootScope.$apply();
            }

            var NetworkSystem = System.extend({
                init: function(updateFrequency) {
                    this._super();

                    this.updateFrequency = updateFrequency || 0.2;
                },
                addedToWorld: function(world) {
                    this._super(world);

                    var activeLevel = $rootWorld.activeLevel;

                    $log.debug('[NetworkSystem addedToWorld]', world.name, activeLevel);

                    this._stream = new Meteor.Stream(activeLevel + '_entities');

                    this._stream.on('transforms', onReceiveTransforms.bind(this));

                    // this for any adds (even first boot)
                    this._stream.on('add', onStreamAdd.bind(this));

                    this._stream.on('remove', function(entityId) {
                        $log.debug('[NetworkSystem : remove]', entityId);
                        var obj = world.scene.getObjectByProperty('uuid', entityId);
                        // test if instanceof Entity?
                        if (obj) {
                            world.removeEntity(obj);
                        } else {
                            $log.debug('not found to remove...');
                        }

                        $rootScope.$apply();
                    });

                    // we also get a private user stream
                    this._userStream = new Meteor.Stream([Meteor.userId(), activeLevel, 'entities'].join('_'));
                    this._userStream.on('add', onStreamAdd.bind(this));
                },
                update: function() {
                    // for now just send transform
                    var entities = this.world.getEntities('netSend'),
                        packet = {};

                    // on the client, this will be low, like the main player mostly?
                    entities.forEach(function(entity) {
                        // we only want to send changed
                        var sendComponent = entity.getComponent('netSend');
                        if (sendComponent._last) {
                            var pos = entity.position.serialize(),
                                rot = entity.rotation.serialize(),
                                lastPos = sendComponent._last.pos,
                                lastRot = sendComponent._last.rot;

                            if (!arraysAreEqual(pos, lastPos) || !arraysAreEqual(rot, lastRot)) {
                                sendComponent._last.pos = pos;
                                sendComponent._last.rot = rot;

                                packet[entity.uuid] = sendComponent._last;
                            }
                        } else {
                            sendComponent._last = {
                                pos: entity.position.serialize(),
                                rot: entity.rotation.serialize()
                            };
                            packet[entity.uuid] = sendComponent._last;
                        }
                    });

                    if (Object.keys(packet).length > 0) {
                        this._stream.emit('transforms', packet);
                    }
                }
            });

            return NetworkSystem;
        }
    ]);
